import Foundation
import KeyboardCore

extension Lexicon {
    nonisolated static let english: Lexicon = {
        let url = Bundle.module.url(forResource: "en", withExtension: "lexicon")!
        return Lexicon(bytes: [UInt8](try! Data(contentsOf: url, options: .alwaysMapped)))!
    }()
}

extension Phrases {
    nonisolated static let english: Phrases = {
        let url = Bundle.module.url(forResource: "en", withExtension: "phrases")!
        return Phrases(bytes: [UInt8](try! Data(contentsOf: url, options: .alwaysMapped)))!
    }()
}
