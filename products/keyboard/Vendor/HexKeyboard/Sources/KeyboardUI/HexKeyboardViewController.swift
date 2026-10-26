import UIKit
import KeyboardCore

open class HexKeyboardViewController: UIInputViewController {
    open var hapticsEnabled: Bool { hasFullAccess && engine.settings.haptics }

    /// Host-owned actions live above Hex's unchanged suggestion bar and key surface.
    open var accessoryHeight: CGFloat { 44 }
    public let accessoryView = UIView()
    /// Offline by default; an injectable boundary for delayed-result controller tests.
    public var swipeRequest: ([SwipeSample], [SwipeKey], [String], SwipeLanguageContext?) async -> [String] = { samples, keys, personal, context in
        await Task.detached(priority: .userInitiated) {
            SwipeDecoderStore.decoder.decode(samples: samples, keys: keys, personal: personal, context: context)
        }.value
    }
    public var swipeEnabled = UserDefaults.standard.object(forKey: "usual.swipeEnabled") as? Bool ?? true {
        didSet {
            UserDefaults.standard.set(swipeEnabled, forKey: "usual.swipeEnabled")
            if !swipeEnabled { cancelSwipeInput() }
        }
    }
    open func didType() {}
    public var knownTextBeforeInput: String { engine.text.before }
    public var knownTextAfterInput: String? { engine.text.after }
    public func replaceKnownDraft(with value: String) {
        cancelSwipeInput()
        engine.replaceKnownDraft(with: value, in: document)
        render()
    }
    public func refreshDocument() { syncWithDocument() }
    private let keyboardView = KeyboardView()
    private let suggestionBar = SuggestionBar()
    private lazy var document = ProxyDocument { [unowned self] in textDocumentProxy }
    private var engine = TypingEngine()
    private lazy var barHeightConstraint = suggestionBar.heightAnchor.constraint(equalToConstant: 0)
    private lazy var keyboardHeightConstraint = keyboardView.heightAnchor.constraint(equalToConstant: 0)
    private var deleteRepeat: DeleteRepeat?
    private let haptics = KeyHaptics()
    private enum QueuedInput { case key(KeyboardEvent), swipe([SwipeSample], [SwipeKey]) }
    private var queuedInput: [QueuedInput] = []
    private var swipeTask: Task<Void, Never>?
    private var swipeGeneration = 0
    public var hasPendingSwipe: Bool { swipeTask != nil || keyboardView.tracked.values.contains { $0.mode == .swipe } }

    override open func loadView() {
        inputView = KeyboardInputView(frame: .zero, inputViewStyle: .default)
    }

    override open func viewDidLoad() {
        super.viewDidLoad()
        view.addSubview(accessoryView)
        accessoryView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(suggestionBar)
        view.addSubview(keyboardView)
        suggestionBar.translatesAutoresizingMaskIntoConstraints = false
        keyboardView.translatesAutoresizingMaskIntoConstraints = false
        keyboardHeightConstraint.priority = .required - 1
        NSLayoutConstraint.activate([
            accessoryView.topAnchor.constraint(equalTo: view.topAnchor),
            accessoryView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            accessoryView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            accessoryView.heightAnchor.constraint(equalToConstant: accessoryHeight),
            suggestionBar.topAnchor.constraint(equalTo: accessoryView.bottomAnchor),
            suggestionBar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            suggestionBar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            barHeightConstraint,
            keyboardView.topAnchor.constraint(equalTo: suggestionBar.bottomAnchor),
            keyboardView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            keyboardView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            keyboardView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            keyboardHeightConstraint,
        ])
        engine.defersSuggestions = true
        keyboardView.onEvent = { [unowned self] in receiveKeyboardEvent($0) }
        keyboardView.onSwipeStarted = { [unowned self] in didType() }
        keyboardView.canStartSwipe = { [unowned self] in
            swipeEnabled && engine.canInsertSwipe && textDocumentProxy.selectedText == nil
        }
        keyboardView.onSwipe = { [unowned self] in receive(.swipe($0, $1)) }
        suggestionBar.onSelect = { [unowned self] in
            cancelSwipeInput()
            feedback(.input)
            engine.accept($0, in: document)
            render()
            didType()
        }
        engine.corrector = Corrector(source: Lexicon.english, phrases: .english)
        keyboardView.resolve = { [unowned self] grid, point in engine.key(atX: point.x, y: point.y, in: grid) }
        keyboardView.onGrid = { [unowned self] in engine.use($0) }
        keyboardView.globeTarget = { [unowned self] control in
            control.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
        }
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (self: Self, _) in self.render() }
        syncWithDocument()
    }

    override open func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        render()
    }

    override open func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        TouchTrace.shared.layout(view)
    }

    override open func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        engine.settings = SettingsStore.load(sharing: hasFullAccess)
        engine.corrector?.memory = MemoryStore.load()
        engine.suggestionsChanged()
        keyboardView.characterPreview = engine.settings.characterPreview
        syncWithDocument()
    }

    override open func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if hapticsEnabled { haptics.start() }
        if swipeEnabled { Task.detached(priority: .utility) { _ = SwipeDecoderStore.decoder } }
        stopSystemGesturesDelayingTouches()
        TouchTrace.shared.watch(view.window)
        Task { [weak self] in
            guard let lexicon = await self?.requestSupplementaryLexicon() else { return }
            self?.engine.corrector?.learn(lexicon)
            self?.engine.suggestionsChanged()
            self?.render()
        }
    }

    override open func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        cancelSwipeInput()
        keyboardView.cancelInputTouches()
        engine.endSession()
        haptics.stop()
        TouchTrace.shared.flush()
        if let memory = engine.corrector?.memory { MemoryStore.save(memory, sharing: hasFullAccess) }
    }

    override open func selectionDidChange(_ textInput: UITextInput?) {
        syncWithDocument()
    }

    override open func textDidChange(_ textInput: UITextInput?) {
        syncWithDocument()
    }

    private func syncWithDocument() {
        engine.update(InputTraits(textDocumentProxy))
        let known = engine.text.before.count
        let report = engine.documentChanged(document)
        if report == .changed { cancelSwipeInput(); keyboardView.cancelInputTouches() }
        TouchTrace.shared.record(report, host: textDocumentProxy.documentContextBeforeInput?.count ?? 0, known: known)
        render()
    }

    private var screenSize: CGSize {
        view.window?.windowScene?.screen.bounds.size ?? view.bounds.size
    }

    private var device: DeviceClass {
        let shortSide = min(screenSize.width, screenSize.height)
        guard traitCollection.userInterfaceIdiom == .pad else { return shortSide >= 600 ? .compactPad : .phone }
        return shortSide >= 1000 ? .largePad : shortSide < 800 ? .compactPad : .pad
    }

    private var barHeight: CGFloat {
        switch (device, engine.showsSuggestions) {
        case (.phone, _): 27
        case (_, true): 36
        case (_, false): 0
        }
    }

    private func render() {
        let device = device
        let context = engine.layout(on: device, showsGlobe: needsInputModeSwitchKey, isLandscape: screenSize.width > screenSize.height)
        let layout = Layouts.layout(for: context)
        let metrics = KeyboardMetrics.for(device, width: screenSize.width, height: screenSize.height, style: .current, oneHanded: context.oneHanded)
        keyboardView.oneHanded = (context.oneHandedKey(in: layout), context.oneHanded)
        keyboardView.update(layout: layout, signature: context.signature, metrics: metrics, faces: engine.faces(on: device), theme: theme)
        suggestionBar.maximumSlotWidth = device == .phone ? .infinity : 154.5
        renderSuggestions()

        let height = metrics.height(rows: layout.rows.count, hasNumberRow: layout.hasNumberRow)
        if keyboardHeightConstraint.constant != height { keyboardHeightConstraint.constant = height }
        if barHeightConstraint.constant != barHeight { barHeightConstraint.constant = barHeight }
    }

    private var theme: KeyboardTheme {
        KeyboardTheme.current(for: traitCollection, appearance: textDocumentProxy.keyboardAppearance)
    }

    private var ranking = false

    private func renderSuggestions() {
        guard engine.suggestionsAreStale else {
            return suggestionBar.update(engine.suggestions, enabled: engine.showsSuggestions, theme: theme)
        }
        guard !ranking, let job = engine.suggestionJob() else { return }
        ranking = true
        Task.detached(priority: .userInitiated) { [weak self] in
            var job = job
            job.run()
            await self?.finish(job)
        }
    }

    private func finish(_ job: SuggestionJob) {
        ranking = false
        engine.finish(job)
        renderSuggestions()
    }

    private func handle(_ event: KeyboardEvent) {
        switch event {
        case .down(let key, _):
            feedback(Self.haptic(for: key))
            if key.action == .delete { startDeleteRepeat() }
        case .up(let key) where key.action == .delete:
            deleteRepeat = nil
        case .trigger(let key) where key.action == .dismiss:
            return dismissKeyboard()
        case .trigger(let key) where key.action == .nextKeyboard:
            return advanceToNextInputMode()
        case .type:
            TouchTrace.shared.mark("typed")
        case .oneHanded(let hand), .pickHand(let hand):
            SettingsStore.set(hand, sharing: hasFullAccess)
        default:
            break
        }
        if engine.handle(event, in: document) { render(); didType() }
    }

    private func receive(_ input: QueuedInput) {
        if swipeTask != nil { queuedInput.append(input); return }
        switch input {
        case .key(let event): handle(event)
        case .swipe(let samples, let keys): beginSwipe(samples: samples, keys: keys)
        }
    }

    public func receiveKeyboardEvent(_ event: KeyboardEvent) { receive(.key(event)) }

    /// Used by the touch view and controller tests. Subsequent taps/swipes are applied in arrival order.
    public func beginSwipe(samples: [SwipeSample], keys: [SwipeKey]) {
        guard swipeEnabled, engine.canInsertSwipe, textDocumentProxy.selectedText == nil else { return }
        if swipeTask != nil { queuedInput.append(.swipe(samples, keys)); return }
        let before = textDocumentProxy.documentContextBeforeInput
        let after = textDocumentProxy.documentContextAfterInput
        let documentID = textDocumentProxy.documentIdentifier
        let generation = swipeGeneration
        let personal = engine.swipeVocabulary
        let context = engine.swipeLanguageContext
        let request = swipeRequest
        // Starting a gesture invalidates a pending Finish even before this word is decoded.
        didType()
        swipeTask = Task { [weak self] in
            let candidates = await request(samples, keys, personal, context)
            guard let self, !Task.isCancelled, generation == swipeGeneration else { return }
            swipeTask = nil
            guard documentID == textDocumentProxy.documentIdentifier,
                  before == textDocumentProxy.documentContextBeforeInput,
                  after == textDocumentProxy.documentContextAfterInput,
                  textDocumentProxy.selectedText == nil else {
                queuedInput = []
                syncWithDocument()
                return
            }
            if engine.insertSwipe(candidates, in: document) {
                didType()
                render()
            } else {
                UIAccessibility.post(notification: .announcement, argument: "Swipe not recognized. Try again or tap.")
            }
            while swipeTask == nil, !queuedInput.isEmpty { receive(queuedInput.removeFirst()) }
        }
    }

    private func cancelSwipeInput() {
        swipeGeneration += 1
        swipeTask?.cancel()
        swipeTask = nil
        queuedInput = []
    }

    private func startDeleteRepeat() {
        deleteRepeat = DeleteRepeat { [unowned self] words in
            if words { engine.deleteWord(in: document) } else { engine.perform(.delete, in: document) }
            feedback(words ? .deletionRapid : .deletionRepeat)
            render()
        }
    }

    private func stopSystemGesturesDelayingTouches() {
        view.window?.gestureRecognizers?.forEach {
            $0.delaysTouchesBegan = false
            $0.delaysTouchesEnded = false
        }
    }

    private func feedback(_ haptic: KeyHaptics.Kind) {
        if engine.settings.sound { UIDevice.current.playInputClick() }
        if hapticsEnabled { haptics.play(haptic) }
    }

    private static func haptic(for key: Key) -> KeyHaptics.Kind {
        switch key.action {
        case .character: .input
        case .space, .return, .tab: .separator
        case .delete: .deletion
        default: .other
        }
    }
}

private enum SwipeDecoderStore {
    nonisolated static let decoder = LocalSwipeDecoder(words: Lexicon.english.swipeWords, maximumFinalists: 24,
                                                       contractions: true, spatialWeight: 0.2)
}

private extension Corrector {
    func learn(_ lexicon: UILexicon) {
        let entries = lexicon.entries
        setReplacements(entries.filter { $0.userInput != $0.documentText }.map { ($0.userInput, $0.documentText) })
        setNames(entries.filter { $0.userInput == $0.documentText }.map(\.documentText))
    }
}
