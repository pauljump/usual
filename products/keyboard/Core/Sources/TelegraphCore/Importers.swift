import Foundation

/// Turns exported history into sent messages. Everything here runs on the device or the
/// Mac; nothing is uploaded. Sources the phone cannot read directly (iMessage, Claude
/// Code, Codex) are learned by the Mac `telegraph` CLI into a `.telegraph` lexicon.
public enum Importers {
    public enum Result {
        case messages([Message])
        case lexicon(Lexicon)
    }

    public static func auto(name: String, data: Data) -> Result {
        let ext = (name as NSString).pathExtension.lowercased()
        if ext == "telegraph" || ext == "json", let lex = try? JSONDecoder().decode(Lexicon.self, from: data) {
            return .lexicon(lex)
        }
        let text = String(decoding: data, as: UTF8.self)
        switch ext {
        case "mbox": return .messages(mbox(text))
        case "jsonl":
            let claude = claudeJSONL(text)
            return .messages(claude.isEmpty ? codexJSONL(text) : claude)
        case "json": return .messages(jsonArray(data, source: "file"))
        default:
            if text.hasPrefix("From ") { return .messages(mbox(text)) }
            return .messages(lines(text, source: "pasted"))
        }
    }

    public static func lines(_ text: String, source: String) -> [Message] {
        text.components(separatedBy: .newlines)
            .map { Message(text: $0, date: nil, source: source) }
            .filter { !$0.text.isEmpty }
    }

    /// `["text", ...]` or `[{"text": "...", "date": "ISO-8601"}, ...]`.
    public static func jsonArray(_ data: Data, source: String) -> [Message] {
        guard let any = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return any.compactMap { item in
            if let s = item as? String { return Message(text: s, date: nil, source: source) }
            guard let d = item as? [String: Any], let t = d["text"] as? String else { return nil }
            return Message(text: t, date: (d["date"] as? String).flatMap(parseISO), source: source)
        }
    }

    // MARK: Agent sessions

    /// Claude Code transcript lines: `{"type":"user","message":{"content":...},"timestamp":...}`.
    public static func claudeJSONL(_ text: String) -> [Message] {
        text.split(separator: "\n").compactMap { line in
            guard let obj = json(line), obj["type"] as? String == "user", obj["isMeta"] as? Bool != true,
                  let message = obj["message"] as? [String: Any] else { return nil }
            let body: String?
            if let s = message["content"] as? String {
                body = s
            } else if let parts = message["content"] as? [[String: Any]] {
                if parts.contains(where: { $0["type"] as? String == "tool_result" }) { return nil }
                body = parts.compactMap { $0["type"] as? String == "text" ? $0["text"] as? String : nil }
                    .joined(separator: " ")
            } else {
                body = nil
            }
            guard let body, isHumanTurn(body) else { return nil }
            return Message(text: body, date: (obj["timestamp"] as? String).flatMap(parseISO), source: "claude")
        }
    }

    /// Codex rollout lines. Older rollouts log `event_msg/user_message`; newer ones log the
    /// user turn as `response_item/message` with `input_text` parts. Both are read, once each.
    public static func codexJSONL(_ text: String) -> [Message] {
        var seen = Set<String>()
        return text.split(separator: "\n").compactMap { line in
            guard let obj = json(line), let payload = obj["payload"] as? [String: Any] else { return nil }
            var body: String?
            switch (obj["type"] as? String, payload["type"] as? String) {
            case ("event_msg", "user_message"):
                body = payload["message"] as? String
            case ("response_item", "message") where payload["role"] as? String == "user":
                body = (payload["content"] as? [[String: Any]])?
                    .compactMap { $0["type"] as? String == "input_text" ? $0["text"] as? String : nil }
                    .joined(separator: " ")
            default:
                return nil
            }
            guard let body, isHumanTurn(body), seen.insert(body).inserted else { return nil }
            return Message(text: body, date: (obj["timestamp"] as? String).flatMap(parseISO), source: "codex")
        }
    }

    /// Drops harness-injected turns (command wrappers, environment blocks, interrupts).
    public static func isHumanTurn(_ s: String) -> Bool {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !t.hasPrefix("<"), !t.hasPrefix("[Request interrupted"),
              !t.hasPrefix("Caveat:"), !t.hasPrefix("# AGENTS.md") else { return false }
        return true
    }

    // MARK: Email

    /// Gmail Takeout (or any) mbox. Keeps only the new text of each message, not quoted replies.
    /// Pass `me` to keep only messages from that address.
    public static func mbox(_ text: String, me: String? = nil) -> [Message] {
        var out: [Message] = []
        var current: [Substring] = []
        func flush() {
            defer { current.removeAll() }
            guard !current.isEmpty, let m = email(current.joined(separator: "\n"), me: me) else { return }
            out.append(m)
        }
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            if line.hasPrefix("From "), current.isEmpty || current.last?.isEmpty == true { flush() }
            current.append(line)
        }
        flush()
        return out
    }

    private static let mailDate: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "EEE, d MMM yyyy HH:mm:ss Z"
        return f
    }()

    static func email(_ raw: String, me: String?) -> Message? {
        let (headers, body) = splitHeaders(raw)
        if let me, !(headers["from"] ?? "").lowercased().contains(me.lowercased()) { return nil }
        let date = headers["date"].flatMap { d in
            mailDate.date(from: d.replacingOccurrences(of: #"\s*\(.*\)$"#, with: "", options: .regularExpression))
        }
        guard let plain = plainText(headers: headers, body: body) else { return nil }
        let fresh = stripQuoted(plain)
        guard !fresh.isEmpty else { return nil }
        let collapsed = fresh.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
            .joined(separator: " ")
        return Message(text: collapsed, date: date, source: "email")
    }

    static func splitHeaders(_ raw: String) -> ([String: String], String) {
        let parts = raw.components(separatedBy: "\n\n")
        guard let head = parts.first else { return ([:], "") }
        var headers: [String: String] = [:]
        var lastKey: String?
        for line in head.components(separatedBy: "\n") {
            if line.first == " " || line.first == "\t", let k = lastKey {
                headers[k, default: ""] += " " + line.trimmingCharacters(in: .whitespaces)
            } else if let colon = line.firstIndex(of: ":") {
                let k = line[..<colon].lowercased()
                headers[k] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                lastKey = k
            }
        }
        return (headers, parts.dropFirst().joined(separator: "\n\n"))
    }

    static func plainText(headers: [String: String], body: String) -> String? {
        let type = (headers["content-type"] ?? "text/plain").lowercased()
        if type.hasPrefix("multipart/") {
            guard let b = type.range(of: "boundary=") else { return nil }
            let original = headers["content-type"]!
            let start = original.index(original.startIndex, offsetBy: type.distance(from: type.startIndex, to: b.upperBound))
            let boundary = original[start...].split(separator: ";").first.map {
                $0.trimmingCharacters(in: CharacterSet(charactersIn: "\" "))
            } ?? ""
            for part in body.components(separatedBy: "--" + boundary).dropFirst() {
                let (h, b) = splitHeaders(part.trimmingCharacters(in: .newlines))
                if let text = plainText(headers: h, body: b) { return text }
            }
            return nil
        }
        guard type.hasPrefix("text/plain") else { return nil }
        switch (headers["content-transfer-encoding"] ?? "").lowercased() {
        case "base64":
            let joined = body.components(separatedBy: .whitespacesAndNewlines).joined()
            return Data(base64Encoded: joined).map { String(decoding: $0, as: UTF8.self) }
        case "quoted-printable":
            return quotedPrintable(body)
        default:
            return body
        }
    }

    static func quotedPrintable(_ s: String) -> String {
        let unfolded = s.replacingOccurrences(of: "=\r\n", with: "").replacingOccurrences(of: "=\n", with: "")
        var bytes: [UInt8] = []
        var i = unfolded.utf8.makeIterator()
        while let c = i.next() {
            if c == UInt8(ascii: "="), let a = i.next(), let b = i.next(),
               let v = UInt8(String(decoding: [a, b], as: UTF8.self), radix: 16) {
                bytes.append(v)
            } else {
                bytes.append(c)
            }
        }
        return String(decoding: bytes, as: UTF8.self)
    }

    static func stripQuoted(_ body: String) -> String {
        var kept: [String] = []
        for line in body.components(separatedBy: .newlines) {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix(">") || t == "--" || t.hasPrefix("-----Original Message") || t.hasPrefix("Sent from my")
                || (t.hasPrefix("On ") && t.hasSuffix("wrote:")) || t.hasPrefix("From: ") { break }
            kept.append(line)
        }
        return kept.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Helpers

    static func json(_ line: Substring) -> [String: Any]? {
        try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any]
    }

    static func parseISO(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }
}
