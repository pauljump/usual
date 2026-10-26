import Foundation

/// Minimal client for TypeSafe's System One endpoint (https://docs.typesafe.ai/api).
/// Jev never writes text: it picks among options we send and returns calibrated
/// probabilities. Charged per input token; output is free.
public struct JevClient: Sendable {
    public static let endpoint = URL(string: "https://api.typesafe.ai/v1/systemone")!

    public let key: String
    public let model: String
    public let timeout: TimeInterval
    private let session: URLSession

    public init(key: String, model: String = "jev-latest", timeout: TimeInterval = 2.5,
                session: URLSession = .shared) {
        self.key = key
        self.model = model
        self.timeout = timeout
        self.session = session
    }

    public struct Timed: Sendable {
        public var response: JevResponse
        public var milliseconds: Int
    }

    public func evaluate(state: JSON, questions: [String: JevQuestion]) async throws -> Timed {
        var request = URLRequest(url: Self.endpoint, timeoutInterval: timeout)
        request.httpMethod = "POST"
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(JevRequest(state: state, model: model, questions: questions))

        let start = Date()
        let (data, response) = try await session.data(for: request)
        let ms = Int(Date().timeIntervalSince(start) * 1000)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else {
            throw JevError.http(status, String(data: data, encoding: .utf8) ?? "")
        }
        return Timed(response: try JSONDecoder().decode(JevResponse.self, from: data), milliseconds: ms)
    }
}

public enum JevError: Error, CustomStringConvertible {
    case http(Int, String)

    public var description: String {
        switch self {
        case let .http(code, body): "Jev HTTP \(code): \(body.prefix(300))"
        }
    }
}

public struct JevRequest: Codable, Sendable {
    public var state: JSON
    public var model: String
    public var questions: [String: JevQuestion]
}

public struct JevQuestion: Codable, Sendable {
    public var type: String
    public var instructions: JSON
    public var criteria: JSON?

    public init(type: String, instructions: JSON, criteria: JSON?) {
        self.type = type
        self.instructions = instructions
        self.criteria = criteria
    }

    public static func choice(_ instructions: JSON, options: [(String, JSON)]) -> JevQuestion {
        JevQuestion(type: "choice", instructions: instructions,
                    criteria: .object(options.map { ($0.0, $0.1) }))
    }

    public static func noul(_ instructions: JSON) -> JevQuestion {
        JevQuestion(type: "noul", instructions: instructions, criteria: nil)
    }
}

public struct JevResponse: Codable, Sendable {
    public var model: String
    public var answers: [String: JevAnswer]
    public var usage: Usage?

    public struct Usage: Codable, Sendable {
        public var input_tokens: Int?
        public var output_tokens: Int?
    }
}

public struct JevAnswer: Codable, Sendable {
    public var type: String
    public var choice: String?
    public var probabilities: [String: Double]?
    public var confidence: Double?
    public var noul: Double?
    public var score: Double?
}

/// Order-preserving JSON value. Order matters: Jev leans toward the first Choice option,
/// so options are sent best-prior-first.
public indirect enum JSON: Codable, Sendable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSON])
    case object([(String, JSON)])

    public static func == (a: JSON, b: JSON) -> Bool {
        switch (a, b) {
        case let (.string(x), .string(y)): x == y
        case let (.number(x), .number(y)): x == y
        case let (.bool(x), .bool(y)): x == y
        case (.null, .null): true
        case let (.array(x), .array(y)): x == y
        case let (.object(x), .object(y)): x.count == y.count && zip(x, y).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: false
        }
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ s: String) { stringValue = s }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case let .string(s): var c = encoder.singleValueContainer(); try c.encode(s)
        case let .number(n): var c = encoder.singleValueContainer(); try c.encode(n)
        case let .bool(b): var c = encoder.singleValueContainer(); try c.encode(b)
        case .null: var c = encoder.singleValueContainer(); try c.encodeNil()
        case let .array(a):
            var c = encoder.unkeyedContainer()
            for v in a { try c.encode(v) }
        case let .object(pairs):
            var c = encoder.container(keyedBy: Key.self)
            for (k, v) in pairs { try c.encode(v, forKey: Key(k)) }
        }
    }

    public init(from decoder: Decoder) throws {
        if let c = try? decoder.container(keyedBy: Key.self) {
            self = .object(try c.allKeys.map { ($0.stringValue, try c.decode(JSON.self, forKey: $0)) })
        } else if var c = try? decoder.unkeyedContainer() {
            var out: [JSON] = []
            while !c.isAtEnd { out.append(try c.decode(JSON.self)) }
            self = .array(out)
        } else {
            let c = try decoder.singleValueContainer()
            if c.decodeNil() { self = .null }
            else if let b = try? c.decode(Bool.self) { self = .bool(b) }
            else if let n = try? c.decode(Double.self) { self = .number(n) }
            else { self = .string(try c.decode(String.self)) }
        }
    }
}
