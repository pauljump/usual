import Foundation

/// Talks to Usual Mini (`service/telegraph_mini.py`) on Paul's Mac over Tailscale.
/// Explicit keyboard actions send the selected/known draft to the Mini, which holds provider
/// credentials. Ordinary typing and personal autocorrect stay on the phone.
enum MiniClient {
    static let base = URL(string: "http://pauls-mac-mini.tail20c872.ts.net:8773")!

    enum Size: String, CaseIterable, Identifiable, Codable {
        case line, paragraph, brief
        var id: String { rawValue }
        var label: String {
            switch self {
            case .line: "Line"
            case .paragraph: "Paragraph"
            case .brief: "Brief"
            }
        }
    }

    struct Score: Codable, Hashable {
        var index: Int
        var meant: Double
        var fits: Double
        var score: Double
    }

    struct Readings: Codable {
        var readings: [String]
        var scores: [Score]
        var sure: Bool
        var choice: Int?
        var ms: [String: Int]?

        /// Readings best first, with Jev's score for each.
        var ranked: [(text: String, score: Score)] {
            scores.compactMap { s in readings.indices.contains(s.index) ? (readings[s.index], s) : nil }
        }
    }

    struct Written: Codable {
        var text: String
        var dropped: Int
        var ms: Int
    }

    struct Failure: LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    static func readings(keys: String, before: String) async throws -> Readings {
        try await post("readings", ["keys": keys, "before": String(before.suffix(400))], timeout: 30)
    }

    static func write(keys: String, reading: String, size: Size) async throws -> Written {
        try await post("write", ["keys": keys, "reading": reading, "size": size.rawValue], timeout: 60)
    }

    struct Rephrased: Codable {
        var text: String
        var same: Double
        var ms: Int
    }

    static func rephrase(text: String) async throws -> Rephrased {
        try await post("rephrase", ["text": text], timeout: 40)
    }

    struct Finished: Codable {
        var text: String
        var accepted: Bool
        var ms: Int
    }

    static func finish(text: String, recent: [String] = []) async throws -> Finished {
        try await post("finish", ["text": text, "recent": recent], timeout: 12)
    }

    private static func post<T: Decodable>(_ path: String, _ body: [String: Any], timeout: TimeInterval) async throws -> T {
        var request = URLRequest(url: base.appendingPathComponent(path), timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data: Data, response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Failure(message: "Can't reach the Mini. Is Tailscale on?")
        }
        guard (response as? HTTPURLResponse)?.statusCode == 200 else {
            let reason = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? "unknown error"
            throw Failure(message: "The Mini said: \(reason)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
