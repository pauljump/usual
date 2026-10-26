import Testing
import KeyboardCore
@testable import KeyboardUI

@MainActor
struct EnglishLexiconTests {
    @Test func wordsWrittenInLowercaseKeepTheirCase() throws {
        let lexicon = Lexicon.english
        for word in ["fox", "mark", "bill", "march", "may", "us", "it", "apple", "hey", "god", "china"] {
            #expect(lexicon.canonical(word) == word)
        }
    }

    @Test func wordsOnlyWrittenCapitalizedGetTheirCapital() throws {
        let lexicon = Lexicon.english
        #expect(lexicon.canonical("i") == "I")
        #expect(lexicon.canonical("i'm") == "I'm")
        #expect(lexicon.canonical("london") == "London")
        #expect(lexicon.canonical("english") == "English")
        #expect(lexicon.canonical("monday") == "Monday")
    }

    @Test func typingALowercaseWordKeepsIt() throws {
        let corrector = Corrector(source: Lexicon.english)
        let grid = KeyGrid.standard
        func correct(_ word: String, after previous: String) -> String? {
            let taps = word.map { letter in
                let frame = grid.frame(of: String(letter))!
                return Tap(x: frame.midX, y: frame.midY, key: String(letter))
            }
            return corrector.correction(for: TypedWord(word, taps: taps, previous: previous))
        }
        #expect(correct("fox", after: "quick") == nil)
        #expect(correct("may", after: "it") == nil)
        #expect(correct("london", after: "in") == "London")
        #expect(correct("i", after: "and") == "I")
    }
}
