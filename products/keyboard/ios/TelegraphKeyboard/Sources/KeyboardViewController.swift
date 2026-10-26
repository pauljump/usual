import UIKit
#if !USUAL_KEYBOARDKIT_PRO
import KeyboardUI
typealias UsualKeyboardBaseController = HexKeyboardViewController
#endif

/// Hex supplies the everyday keys. Usual supplies the three explicit draft actions.
class KeyboardViewController: UsualKeyboardBaseController {
    // Dependencies remain the real Mini by default; controller tests substitute delayed results.
    var finishRequest: (String, [String]) async throws -> MiniClient.Finished = { try await MiniClient.finish(text: $0, recent: $1) }
    var rephraseRequest: (String) async throws -> MiniClient.Rephrased = { try await MiniClient.rephrase(text: $0) }
    private let row = UIStackView()
    private let finishButton = UIButton(type: .system)
    private let rephraseButton = UIButton(type: .system)
    private let expandButton = UIButton(type: .system)
    private let undoButton = UIButton(type: .system)
    private var work: Task<Void, Never>?
    private var revision = 0
    private var undo: (snapshot: Draft, original: String)?
    private var recent: [String] = []
    private var pending: (draft: Draft, keys: String, size: MiniClient.Size)?

    private struct Draft {
        let before: String
        let after: String
        let selected: String?
        let hostBefore: String?
        let hostAfter: String?
        let document: UUID
        let revision: Int
        var text: String { selected ?? before + after }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fillProportionally
        accessoryView.addSubview(row)
        row.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            row.leadingAnchor.constraint(equalTo: accessoryView.leadingAnchor, constant: 6),
            row.trailingAnchor.constraint(equalTo: accessoryView.trailingAnchor, constant: -6),
            row.topAnchor.constraint(equalTo: accessoryView.topAnchor, constant: 3),
            row.bottomAnchor.constraint(equalTo: accessoryView.bottomAnchor, constant: -3)
        ])
        for button in [finishButton, rephraseButton, expandButton, undoButton] {
            button.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
            button.layer.cornerRadius = 9
            button.accessibilityIdentifier = "usual." + (button === finishButton ? "finish" : button === rephraseButton ? "rephrase" : button === expandButton ? "expand" : "undo")
            row.addArrangedSubview(button)
        }
        finishButton.backgroundColor = .systemBlue
        finishButton.tintColor = .white
        finishButton.addTarget(self, action: #selector(finishTapped), for: .touchUpInside)
        rephraseButton.addTarget(self, action: #selector(rephraseTapped), for: .touchUpInside)
        undoButton.addTarget(self, action: #selector(undoTapped), for: .touchUpInside)
        resetBar()
    }

    override func didType() {
        revision += 1
        undo = nil
        undoButton.isEnabled = false
        // Pending requests may finish, but their captured revision can no longer replace this draft.
    }

    override func viewWillDisappear(_ animated: Bool) {
        work?.cancel(); work = nil; pending = nil
        super.viewWillDisappear(animated)
    }

    private func snapshot() -> Draft {
        Draft(before: knownTextBeforeInput, after: knownTextAfterInput ?? "",
              selected: textDocumentProxy.selectedText,
              hostBefore: textDocumentProxy.documentContextBeforeInput,
              hostAfter: textDocumentProxy.documentContextAfterInput,
              document: textDocumentProxy.documentIdentifier, revision: revision)
    }

    private func unchanged(_ draft: Draft) -> Bool {
        draft.document == textDocumentProxy.documentIdentifier && draft.revision == revision
        && draft.hostBefore == textDocumentProxy.documentContextBeforeInput
        && draft.hostAfter == textDocumentProxy.documentContextAfterInput
        && draft.selected == textDocumentProxy.selectedText
    }

    private func capture() -> Draft? {
        #if !USUAL_KEYBOARDKIT_PRO
        guard !hasPendingSwipe else { message("Let the swiped word finish first"); return nil }
        #endif
        guard hasFullAccess else { message("Enable Full Access in Settings"); return nil }
        let draft = snapshot()
        guard !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { message("Type a draft first"); return nil }
        guard draft.text.count <= 6000 else { message("Select a shorter draft (6,000 characters max)"); return nil }
        return draft
    }

    @objc private func finishTapped() {
        if work != nil { work?.cancel(); work = nil; resetBar(); return }
        guard let draft = capture() else { return }
        busy("Finishing…")
        work = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await finishRequest(draft.text, recent)
                guard !Task.isCancelled else { return }
                guard result.accepted else { work = nil; message("Uncertain — kept your draft"); return }
                apply(result.text, to: draft)
            } catch { if !Task.isCancelled { work = nil; message(error.localizedDescription) } }
        }
    }

    @objc private func rephraseTapped() {
        guard work == nil, let draft = capture() else { return }
        busy("Rephrasing…")
        work = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await rephraseRequest(draft.text)
                guard !Task.isCancelled else { return }
                guard result.same >= 0.5 else { work = nil; message("Meaning uncertain — kept your draft"); return }
                apply(result.text, to: draft)
            } catch { if !Task.isCancelled { work = nil; message(error.localizedDescription) } }
        }
    }

    private func expand(_ size: MiniClient.Size) {
        guard work == nil, let draft = capture() else { return }
        busy("Reading…")
        work = Task { [weak self] in
            guard let self else { return }
            do {
                let keys = draft.text
                let result = try await MiniClient.readings(keys: keys, before: "")
                guard !Task.isCancelled else { return }
                guard unchanged(draft) else { work = nil; message("Draft changed — tap again"); return }
                if result.sure, let index = result.choice, result.readings.indices.contains(index) {
                    await write(keys: keys, reading: result.readings[index], size: size, draft: draft)
                } else {
                    work = nil
                    pending = (draft, keys, size)
                    resetBar()
                    expandButton.setTitle("Choose…", for: .normal)
                    expandButton.menu = UIMenu(title: "What did you mean?", children: result.ranked.map { item in
                        UIAction(title: item.text) { [weak self] _ in
                            guard let self, let p = pending else { return }
                            busy("Expanding…")
                            work = Task { await self.write(keys: p.keys, reading: item.text, size: p.size, draft: p.draft) }
                        }
                    })
                }
            } catch { if !Task.isCancelled { work = nil; message(error.localizedDescription) } }
        }
    }

    private func write(keys: String, reading: String, size: MiniClient.Size, draft: Draft) async {
        do {
            let result = try await MiniClient.write(keys: keys, reading: reading, size: size)
            guard !Task.isCancelled else { return }
            apply(result.text, to: draft)
        } catch { if !Task.isCancelled { work = nil; message(error.localizedDescription) } }
    }

    private func apply(_ text: String, to draft: Draft) {
        work = nil
        guard unchanged(draft) else { message("Draft changed — tap again"); return }
        if draft.selected != nil {
            textDocumentProxy.insertText(text)
        } else {
            replaceKnownDraft(with: text)
        }
        revision += 1
        refreshDocument()
        undo = (snapshot(), draft.text)
        recent = Array((recent + [text]).suffix(5))
        pending = nil
        resetBar()
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    @objc private func undoTapped() {
        guard let saved = undo, unchanged(saved.snapshot) else { undo = nil; resetBar(); return }
        // The result was inserted immediately before the cursor; preserve any suffix outside a selection.
        for _ in 0..<(recent.last?.count ?? 0) { textDocumentProxy.deleteBackward() }
        textDocumentProxy.insertText(saved.original)
        undo = nil; revision += 1; refreshDocument(); resetBar()
    }

    private func busy(_ title: String) {
        finishButton.setTitle("Cancel", for: .normal)
        rephraseButton.setTitle(title, for: .normal)
        rephraseButton.isEnabled = false; expandButton.isEnabled = false; undoButton.isEnabled = false
    }

    private func message(_ text: String) {
        resetBar()
        rephraseButton.setTitle("Info", for: .normal)
        rephraseButton.accessibilityLabel = text
        rephraseButton.menu = UIMenu(children: [UIAction(title: text, attributes: .disabled) { _ in }])
        rephraseButton.showsMenuAsPrimaryAction = true
        UIAccessibility.post(notification: .announcement, argument: text)
    }

    private func resetBar() {
        finishButton.setTitle("Finish", for: .normal)
        rephraseButton.setTitle("Rephrase", for: .normal)
        rephraseButton.menu = nil; rephraseButton.showsMenuAsPrimaryAction = false
        rephraseButton.accessibilityLabel = "Rephrase"
        expandButton.setTitle("Expand ▾", for: .normal)
        undoButton.setTitle("Undo", for: .normal)
        rephraseButton.isEnabled = true; expandButton.isEnabled = true; undoButton.isEnabled = undo != nil
        expandButton.showsMenuAsPrimaryAction = true
        var choices: [UIMenuElement] = MiniClient.Size.allCases.map { size in
            UIAction(title: size.label) { [weak self] _ in self?.expand(size) }
        }
        #if !USUAL_KEYBOARDKIT_PRO
        choices.append(UIMenu(title: "Typing", children: [
            UIAction(title: "Swipe typing", state: swipeEnabled ? .on : .off) { [weak self] _ in
                guard let self else { return }
                swipeEnabled.toggle()
                resetBar()
            }
        ]))
        #endif
        expandButton.menu = UIMenu(title: "Expand key words into…", children: choices)
    }
}
