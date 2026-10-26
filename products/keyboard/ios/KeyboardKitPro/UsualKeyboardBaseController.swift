import UIKit
import SwiftUI
import KeyboardKit

/// Optional BARkey/KeyboardKit Pro backend. The action controller above it is identical to Hex.
/// Licensed setup must provide a runtime key; a free setup cannot render the accessory row.
class UsualKeyboardBaseController: KeyboardInputViewController {
    let accessoryView = UIView()
    var accessoryHeight: CGFloat { 44 }
    var knownTextBeforeInput: String { textDocumentProxy.documentContextBeforeInput ?? "" }
    var knownTextAfterInput: String? { textDocumentProxy.documentContextAfterInput }
    func didType() {}
    func refreshDocument() {}

    override func viewDidLoad() {
        super.viewDidLoad()
        Task { [weak self] in
            guard let self else { return }
            do {
                let license: LicenseResponse = try await MiniClient.keyboardLicense()
                setupKeyboardKit(for: .init(name: "Usual", licenseKey: license.key,
                    appGroupId: "group.com.pauljump.telegraph", locales: [.english])) { [weak self] result in
                    if case .success = result { self?.services.autocompleteService = AppleAutocompleteService() }
                }
            } catch {
                // No free-mode fallback: that would hide Finish. Rebuild Hex if the license is unavailable.
                let label = UILabel()
                label.text = "License unavailable. Use the Hex build."
                label.textAlignment = .center
                view.addSubview(label); label.frame = view.bounds
            }
        }
    }

    override func viewWillSetupKeyboardView() {
        setupKeyboardView { [weak self] controller in
            VStack(spacing: 0) {
                if let self { Accessory(view: self.accessoryView).frame(height: self.accessoryHeight) }
                KeyboardView(layout: .standard(for: controller.state.keyboardContext),
                    services: controller.services, buttonContent: { $0.view }, buttonView: { $0.view },
                    collapsedView: { $0.view }, emojiKeyboard: { $0.view }, toolbar: { $0.view })
            }
        }
    }

    override func textDidChange(_ textInput: (any UITextInput)?) {
        super.textDidChange(textInput)
        didType()
    }

    func replaceKnownDraft(with value: String) {
        let before = knownTextBeforeInput
        let after = knownTextAfterInput ?? ""
        textDocumentProxy.adjustTextPosition(byCharacterOffset: after.count)
        for _ in 0..<(before.count + after.count) { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(value)
    }
}

private struct Accessory: UIViewRepresentable {
    let view: UIView
    func makeUIView(context: Context) -> UIView { view }
    func updateUIView(_ uiView: UIView, context: Context) {}
}

struct LicenseResponse: Decodable { let key: String }
extension MiniClient {
    static func keyboardLicense() async throws -> LicenseResponse {
        let (data, response) = try await URLSession.shared.data(from: base.appendingPathComponent("keyboard-license"))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure(message: "KeyboardKit license unavailable") }
        return try JSONDecoder().decode(LicenseResponse.self, from: data)
    }
}
