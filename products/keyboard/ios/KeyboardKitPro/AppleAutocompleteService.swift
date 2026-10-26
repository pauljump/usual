import UIKit
import KeyboardKit

/// Custom autocomplete service using Apple's UITextChecker plus
/// contraction expansion, common typo fixes, and next-word prediction.
class AppleAutocompleteService: AutocompleteService {

    var locale: Locale = .current

    private let textChecker = UITextChecker()

    private var language: String {
        let id = locale.identifier.replacingOccurrences(of: "_", with: "-")
        return UITextChecker.availableLanguages.contains(id) ? id : "en-US"
    }

    // MARK: - Core autocomplete

    func autocomplete(_ text: String) async throws -> Autocomplete.Result {
        let suggestions = buildSuggestions(for: text)
        return Autocomplete.Result(
            inputText: text,
            suggestions: suggestions
        )
    }

    private func buildSuggestions(for text: String) -> [Autocomplete.Suggestion] {
        guard !text.isEmpty else { return [] }

        // If the text ends with a space, predict the next word
        if text.last?.isWhitespace == true {
            return nextWordSuggestions(for: text)
        }

        let currentWord = extractCurrentWord(from: text)
        guard !currentWord.isEmpty else { return [] }

        let lower = currentWord.lowercased()

        // 1. Standalone "i" → "I"
        if lower == "i" {
            return [Autocomplete.Suggestion(text: "I", type: .autocorrect)]
        }

        // 2. Contraction dictionary
        if let contraction = contractions[lower] {
            return [
                Autocomplete.Suggestion(text: currentWord, type: .regular),
                Autocomplete.Suggestion(text: contraction, type: .autocorrect),
            ]
        }

        // 3. Common typos dictionary
        if let correction = commonTypos[lower] {
            let corrected = matchCapitalization(correction, to: currentWord)
            return [
                Autocomplete.Suggestion(text: currentWord, type: .regular),
                Autocomplete.Suggestion(text: corrected, type: .autocorrect),
            ]
        }

        // 4. UITextChecker — pass full text for context-aware checking
        let fullText = text as NSString
        let wordLocation = fullText.length - (currentWord as NSString).length
        let wordRange = NSRange(location: wordLocation, length: (currentWord as NSString).length)

        let misspelledRange = textChecker.rangeOfMisspelledWord(
            in: text,
            range: wordRange,
            startingAt: wordLocation,
            wrap: false,
            language: language
        )
        let isMisspelled = misspelledRange.location != NSNotFound

        var corrections: [String] = []
        if isMisspelled {
            corrections = textChecker.guesses(
                forWordRange: wordRange,
                in: text,
                language: language
            ) ?? []
        }

        // Completions with full text context
        let completions = (textChecker.completions(
            forPartialWordRange: wordRange,
            in: text,
            language: language
        ) ?? []).filter { $0.lowercased() != lower }

        var suggestions: [Autocomplete.Suggestion] = []

        if isMisspelled, let topCorrection = corrections.first {
            suggestions.append(Autocomplete.Suggestion(text: currentWord, type: .regular))
            suggestions.append(Autocomplete.Suggestion(text: topCorrection, type: .autocorrect))
            let alt = corrections.count > 1 ? corrections[1] : completions.first
            if let alt, alt.lowercased() != topCorrection.lowercased() {
                suggestions.append(Autocomplete.Suggestion(text: alt, type: .regular))
            }
        } else {
            if completions.count > 0 {
                suggestions.append(Autocomplete.Suggestion(text: completions[0], type: .regular))
            }
            suggestions.append(Autocomplete.Suggestion(text: currentWord, type: .regular))
            if completions.count > 1 {
                suggestions.append(Autocomplete.Suggestion(text: completions[1], type: .regular))
            }
        }

        return suggestions
    }

    // MARK: - Next-word prediction

    /// When the user has typed a word and pressed space, suggest likely next words.
    private func nextWordSuggestions(for text: String) -> [Autocomplete.Suggestion] {
        let words = text.trimmingCharacters(in: .whitespaces)
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }

        guard let lastWord = words.last?.lowercased() else { return [] }

        // Check bigram table for the last word
        if let predictions = nextWordTable[lastWord] {
            return predictions.prefix(3).map {
                Autocomplete.Suggestion(text: $0, type: .regular)
            }
        }

        // Check last two words for trigram-like patterns
        if words.count >= 2 {
            let twoWords = words.suffix(2).map { $0.lowercased() }.joined(separator: " ")
            if let predictions = phraseTable[twoWords] {
                return predictions.prefix(3).map {
                    Autocomplete.Suggestion(text: $0, type: .regular)
                }
            }
        }

        return []
    }

    // MARK: - Helpers

    private func extractCurrentWord(from text: String) -> String {
        var end = text.endIndex
        while end > text.startIndex && text[text.index(before: end)].isWhitespace {
            end = text.index(before: end)
        }
        var start = end
        while start > text.startIndex && !text[text.index(before: start)].isWhitespace {
            start = text.index(before: start)
        }
        return String(text[start..<end])
    }

    private func matchCapitalization(_ correction: String, to original: String) -> String {
        if original == original.uppercased() && original.count > 1 {
            return correction.uppercased()
        } else if original.first?.isUppercase == true {
            return correction.prefix(1).uppercased() + correction.dropFirst()
        }
        return correction
    }

    // MARK: - Word learning (persisted to App Group)

    private static let suiteName = "group.com.pauljump.telegraph"
    private static let learnedKey = "learned_words"

    private var _learnedWords: [String] = {
        let defaults = UserDefaults(suiteName: AppleAutocompleteService.suiteName)
        return defaults?.stringArray(forKey: AppleAutocompleteService.learnedKey) ?? []
    }()
    private var _ignoredWords: [String] = []

    var canIgnoreWords: Bool { true }
    var canLearnWords: Bool { true }
    var ignoredWords: [String] { _ignoredWords }
    var learnedWords: [String] { _learnedWords }

    func hasIgnoredWord(_ word: String) -> Bool { _ignoredWords.contains(word) }
    func hasLearnedWord(_ word: String) -> Bool { _learnedWords.contains(word) }

    func ignoreWord(_ word: String) {
        if !_ignoredWords.contains(word) { _ignoredWords.append(word) }
    }

    func learnWord(_ word: String) {
        if !_learnedWords.contains(word) {
            _learnedWords.append(word)
            UITextChecker.learnWord(word)
            let defaults = UserDefaults(suiteName: AppleAutocompleteService.suiteName)
            defaults?.set(_learnedWords, forKey: AppleAutocompleteService.learnedKey)
        }
    }

    func removeIgnoredWord(_ word: String) {
        _ignoredWords.removeAll { $0 == word }
    }

    func unlearnWord(_ word: String) {
        _learnedWords.removeAll { $0 == word }
        UITextChecker.unlearnWord(word)
        let defaults = UserDefaults(suiteName: AppleAutocompleteService.suiteName)
        defaults?.set(_learnedWords, forKey: AppleAutocompleteService.learnedKey)
    }

    // MARK: - Contraction dictionary

    private let contractions: [String: String] = [
        "im": "I'm", "ive": "I've", "ill": "I'll", "id": "I'd",
        "youre": "you're", "youve": "you've", "youll": "you'll", "youd": "you'd",
        "theyre": "they're", "theyve": "they've", "theyll": "they'll", "theyd": "they'd",
        "were": "we're", "weve": "we've", "well": "we'll", "wed": "we'd",
        "hes": "he's", "hed": "he'd", "hell": "he'll",
        "shes": "she's", "shed": "she'd", "shell": "she'll",
        "its": "it's", "itll": "it'll", "itd": "it'd",
        "dont": "don't", "doesnt": "doesn't", "didnt": "didn't",
        "cant": "can't", "couldnt": "couldn't",
        "wont": "won't", "wouldnt": "wouldn't",
        "shouldnt": "shouldn't", "shoudnt": "shouldn't",
        "isnt": "isn't", "wasnt": "wasn't", "werent": "weren't", "arent": "aren't",
        "hasnt": "hasn't", "havent": "haven't", "hadnt": "hadn't",
        "mustnt": "mustn't", "neednt": "needn't",
        "couldve": "could've", "wouldve": "would've", "shouldve": "should've",
        "mustve": "must've", "mightve": "might've",
        "thats": "that's", "whats": "what's", "whos": "who's",
        "wheres": "where's", "heres": "here's", "theres": "there's",
        "lets": "let's", "whens": "when's", "hows": "how's",
    ]

    // MARK: - Common typos dictionary

    private let commonTypos: [String: String] = [
        "teh": "the", "hte": "the", "tge": "the",
        "adn": "and", "nad": "and", "anf": "and",
        "taht": "that", "htat": "that",
        "wiht": "with", "iwth": "with", "wih": "with",
        "fro": "for", "ofr": "for",
        "yuo": "you", "yoi": "you",
        "jsut": "just", "juts": "just",
        "knwo": "know", "konw": "know",
        "liek": "like", "lkie": "like",
        "ahve": "have", "hvae": "have",
        "waht": "what", "hwat": "what",
        "thier": "their", "theit": "their",
        "becuase": "because", "becasue": "because", "beacuse": "because",
        "recieve": "receive",
        "occured": "occurred", "occuring": "occurring",
        "definately": "definitely", "definatly": "definitely", "defiantly": "definitely",
        "seperate": "separate", "seperately": "separately",
        "untill": "until", "unitl": "until",
        "wich": "which", "whcih": "which",
        "woudl": "would", "wuold": "would",
        "shoudl": "should", "shuold": "should",
        "coudl": "could", "cuold": "could",
        "beign": "being", "bieng": "being",
        "goign": "going", "giong": "going",
        "comign": "coming",
        "doign": "doing",
        "nto": "not",
        "hwo": "how",
        "nwo": "now", "onw": "now",
        "owuld": "would",
        "abuot": "about", "baout": "about",
        "peoepl": "people", "peopel": "people",
        "soem": "some", "smoe": "some",
        "tihs": "this", "htis": "this",
        "amke": "make", "mkae": "make",
        "godo": "good", "goood": "good",
        "rigth": "right", "rihgt": "right",
        "thign": "thing", "tihng": "thing",
        "sicne": "since",
        "ot": "to", "fo": "of", "si": "is", "ni": "in",
        "od": "do", "os": "so", "ti": "it", "em": "me",
        "og": "go", "ro": "or",
        "eveyr": "every",
        "poeple": "people",
        "alot": "a lot",
        "thankyou": "thank you",
        "goverment": "government",
        "tommorow": "tomorrow", "tomorow": "tomorrow", "tomorrw": "tomorrow",
    ]

    // MARK: - Next-word prediction tables

    /// Common next words after a given word (bigrams).
    private let nextWordTable: [String: [String]] = [
        "i": ["think", "have", "don't", "am", "was", "can", "will", "need", "want", "know"],
        "i'm": ["not", "going", "sorry", "sure", "just", "so", "gonna", "trying", "here", "good"],
        "i'll": ["be", "let", "do", "get", "send", "call", "try", "check", "have", "take"],
        "i've": ["been", "got", "never", "already", "had", "just", "heard", "seen", "done"],
        "you": ["can", "have", "are", "want", "need", "know", "should", "think", "don't", "too"],
        "you're": ["right", "welcome", "not", "going", "so", "the", "good", "gonna"],
        "it": ["is", "was", "would", "will", "should", "looks", "seems", "doesn't", "works"],
        "it's": ["a", "not", "the", "just", "so", "been", "going", "okay", "fine", "good"],
        "that": ["is", "was", "would", "sounds", "makes", "works", "looks", "one"],
        "that's": ["great", "fine", "good", "what", "so", "the", "true", "right", "awesome", "cool"],
        "the": ["best", "same", "first", "last", "next", "most", "new", "other", "only", "whole"],
        "this": ["is", "was", "one", "morning", "week", "weekend"],
        "we": ["can", "should", "need", "have", "are", "will", "could", "don't", "were"],
        "we're": ["going", "not", "still", "gonna", "all", "here", "good"],
        "he": ["is", "was", "said", "has", "will", "can", "would", "didn't", "does"],
        "she": ["is", "was", "said", "has", "will", "can", "would", "didn't", "does"],
        "they": ["are", "have", "were", "said", "will", "can", "would", "don't"],
        "do": ["you", "not", "it", "that", "we", "they", "this"],
        "don't": ["know", "think", "have", "want", "worry", "need", "forget", "be"],
        "can": ["you", "we", "I", "do", "be", "get", "make", "have"],
        "can't": ["wait", "believe", "do", "make", "find", "get", "see", "be"],
        "will": ["be", "do", "have", "you", "get", "let", "send", "take"],
        "would": ["be", "you", "like", "love", "have", "rather"],
        "should": ["be", "I", "we", "have", "do", "probably"],
        "have": ["a", "to", "you", "been", "the", "any", "no"],
        "had": ["a", "to", "the", "no", "been", "some"],
        "what": ["is", "are", "do", "does", "about", "happened", "time", "did", "would"],
        "what's": ["up", "the", "going", "your", "wrong", "happening", "that", "new"],
        "how": ["are", "is", "do", "about", "much", "many", "long", "was", "did"],
        "how's": ["it", "everything", "that", "your", "the", "work"],
        "when": ["are", "is", "do", "did", "will", "does", "I", "you", "we"],
        "where": ["are", "is", "do", "did", "were", "should"],
        "why": ["don't", "did", "is", "are", "would", "do", "not"],
        "if": ["you", "I", "we", "it", "they", "that", "the", "there"],
        "but": ["I", "it", "the", "that", "we", "you", "he", "she"],
        "so": ["I", "much", "far", "good", "what", "that", "many", "we"],
        "just": ["a", "got", "wanted", "need", "let", "saw", "had", "finished"],
        "not": ["sure", "yet", "really", "going", "a", "the", "gonna"],
        "no": ["problem", "worries", "thanks", "way", "idea", "one", "I"],
        "yes": ["I", "please", "it", "that", "of", "we", "absolutely"],
        "yeah": ["I", "that", "it", "for", "sure", "definitely", "exactly", "of"],
        "ok": ["sounds", "great", "thanks", "I'll", "cool", "perfect", "let"],
        "okay": ["sounds", "great", "thanks", "I'll", "cool", "perfect", "let"],
        "sure": ["thing", "I", "no", "let", "that", "sounds", "we"],
        "thanks": ["for", "so", "a", "I", "again"],
        "thank": ["you", "god", "goodness"],
        "sorry": ["I", "about", "for", "to", "but"],
        "good": ["morning", "luck", "night", "job", "idea", "to", "one", "point"],
        "nice": ["to", "one", "job", "work"],
        "great": ["job", "idea", "to", "thanks", "work"],
        "really": ["good", "like", "want", "need", "appreciate", "enjoyed", "sorry"],
        "very": ["much", "good", "nice", "well", "happy", "sorry", "cool"],
        "going": ["to", "on", "well", "out", "home", "back"],
        "want": ["to", "me", "a", "some", "it", "that", "the"],
        "need": ["to", "a", "some", "the", "help", "it", "more"],
        "like": ["a", "the", "that", "to", "it", "this"],
        "think": ["I", "it", "that", "we", "so", "about", "the"],
        "know": ["what", "that", "if", "how", "about", "I", "the"],
        "get": ["a", "the", "it", "back", "home", "some", "to", "out"],
        "got": ["a", "it", "the", "to", "some", "home", "back"],
        "let": ["me", "us", "them", "him", "her", "it"],
        "let's": ["go", "do", "get", "see", "try", "meet", "talk"],
        "see": ["you", "if", "what", "the", "how", "that"],
        "look": ["at", "like", "for", "into", "forward", "good"],
        "come": ["on", "over", "back", "here", "in", "to"],
        "go": ["to", "ahead", "for", "out", "back", "home", "with"],
        "take": ["a", "care", "the", "it", "that", "some"],
        "make": ["sure", "a", "it", "the", "sense"],
        "on": ["my", "the", "it", "your", "a", "this", "that"],
        "in": ["the", "a", "my", "this", "that", "your"],
        "at": ["the", "home", "least", "all", "work", "a", "this"],
        "to": ["be", "do", "get", "go", "have", "make", "see", "the"],
        "for": ["the", "a", "you", "me", "sure", "now", "that", "this"],
        "with": ["the", "a", "you", "me", "my", "that", "this"],
        "about": ["the", "it", "that", "this", "a", "what", "how"],
        "be": ["a", "the", "there", "able", "back", "home", "in"],
        "up": ["to", "with", "for", "the", "a", "and", "in"],
        "out": ["of", "the", "to", "for", "there", "here", "and"],
        "my": ["phone", "car", "house", "way", "friend", "mom", "dad"],
        "your": ["phone", "car", "house", "way", "friend", "mom", "dad"],
        "a": ["lot", "little", "few", "good", "great", "new", "big"],
        "an": ["hour", "email", "idea", "issue", "update", "option"],
        "one": ["of", "more", "thing", "day", "time", "second", "minute"],
        "all": ["good", "the", "of", "right", "day", "set", "done"],
        "are": ["you", "we", "they", "there", "the", "going"],
        "is": ["it", "that", "the", "there", "a", "going", "this"],
        "was": ["a", "the", "just", "going", "it", "that", "wondering"],
        "been": ["a", "to", "the", "there", "going", "doing", "working"],
        "did": ["you", "not", "it", "that", "he", "she", "they", "we"],
    ]

    /// Common two-word phrases and what follows them.
    private let phraseTable: [String: [String]] = [
        "i think": ["it", "that", "we", "so", "I", "the"],
        "i don't": ["know", "think", "want", "have", "need", "care"],
        "i can't": ["wait", "believe", "do", "make", "find"],
        "do you": ["want", "have", "know", "think", "need", "like"],
        "are you": ["going", "sure", "okay", "coming", "free", "ready", "there"],
        "can you": ["send", "do", "get", "help", "check", "come", "call"],
        "let me": ["know", "check", "think", "see", "get", "ask"],
        "going to": ["be", "do", "get", "have", "the", "go", "try"],
        "want to": ["go", "do", "get", "be", "see", "know", "make"],
        "need to": ["go", "do", "get", "be", "talk", "check", "find"],
        "have to": ["go", "do", "get", "be", "say", "ask", "work"],
        "trying to": ["get", "find", "make", "do", "be", "figure"],
        "looking for": ["a", "the", "something", "someone", "some"],
        "looking at": ["the", "it", "a", "some", "this"],
        "thank you": ["so", "for", "very"],
        "sounds good": ["to", "I'll", "let's", "thanks", "see"],
        "sounds like": ["a", "fun", "good", "it", "the", "you"],
        "how about": ["we", "you", "this", "that", "the", "tomorrow"],
        "what about": ["the", "you", "this", "that", "tomorrow"],
        "on my": ["way", "phone", "end", "own", "mind", "list"],
        "be there": ["in", "soon", "at", "by", "around"],
    ]
}
