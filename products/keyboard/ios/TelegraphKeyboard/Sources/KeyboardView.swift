import SwiftUI

/// Apple-style keys with a suggestion bar. The bar holds Rephrase on the left and length + ✦ on
/// the right; it turns into progress, readings to pick from, or an error when needed.
struct KeyboardView: View {
    @Bindable var model: KeyboardModel
    var needsGlobe: Bool
    var nextKeyboard: () -> Void

    private let letters: [[Character]] = [Array("qwertyuiop"), Array("asdfghjkl"), Array("zxcvbnm")]
    private let symbolRows: [[Character]] = [Array("1234567890"), Array("-/:;()$&@\""), Array(".,?!'")]

    var body: some View {
        VStack(spacing: 4) {
            bar.frame(height: 44)
            keys
                .disabled(model.phase == .thinking || model.phase == .writing || model.phase == .rephrasing)
                .opacity(model.phase == .idle || model.phase == .choosing || isFailed ? 1 : 0.45)
        }
        .padding(.horizontal, 3)
        .padding(.bottom, 4)
    }

    private var isFailed: Bool { if case .failed = model.phase { true } else { false } }

    // MARK: Bar

    @ViewBuilder
    private var bar: some View {
        switch model.phase {
        case .idle:
            HStack(spacing: 2) {
                Button { model.rephrase() } label: {
                    Image(systemName: "arrow.triangle.2.circlepath").font(.body.weight(.medium)).frame(width: 40, height: 40)
                }
                .accessibilityLabel("Rephrase")
                ForEach(Array(model.suggestions.enumerated()), id: \.offset) { i, s in
                    if i > 0 { Divider().frame(height: 22) }
                    Button { model.use(s.trimmingCharacters(in: CharacterSet(charactersIn: "\u{201C}\u{201D}"))) } label: {
                        Text(s)
                            .font(.body)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                            .frame(maxWidth: .infinity, minHeight: 40)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                Menu {
                    Picker("Length", selection: $model.size) {
                        ForEach(MiniClient.Size.allCases) { Text($0.label).tag($0) }
                    }
                } label: {
                    Text(String(model.size.label.prefix(1)))
                        .font(.caption.weight(.semibold))
                        .frame(width: 24, height: 24)
                        .background(Color(uiColor: .tertiarySystemFill), in: Circle())
                }
                Button { model.expand() } label: {
                    Image(systemName: "sparkles")
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 32)
                        .background(Color.accentColor, in: RoundedRectangle(cornerRadius: 8))
                }
                .accessibilityLabel("Expand key words")
            }
        case .thinking, .writing, .rephrasing:
            HStack(spacing: 8) {
                ProgressView()
                Text(model.phase == .rephrasing ? "Rephrasing…" : model.phase == .thinking ? "Reading your key words…" : "Writing it out…")
                    .font(.subheadline)
                Spacer()
                Button("Cancel") { model.cancel() }.font(.subheadline)
            }
            .padding(.horizontal, 8)
        case .choosing:
            HStack(spacing: 6) {
                Button { model.cancel() } label: { Image(systemName: "xmark").frame(width: 30, height: 36) }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array((model.readings?.ranked ?? []).enumerated()), id: \.offset) { n, item in
                            Button { model.choose(item.text) } label: {
                                Text(item.text)
                                    .font(.footnote)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                    .frame(width: 240, alignment: .leading)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 3)
                                    .background(n == 0 ? Color.accentColor.opacity(0.25) : Color(uiColor: .secondarySystemFill),
                                                in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .scrollEdgeEffectHidden(true, for: .all)
            }
        case let .failed(message):
            Button { model.dismissError() } label: {
                HStack {
                    Image(systemName: "exclamationmark.circle")
                    Text(message).font(.footnote).lineLimit(2).multilineTextAlignment(.leading)
                    Spacer()
                    Image(systemName: "xmark").font(.caption)
                }
                .foregroundStyle(.orange)
                .padding(.horizontal, 8)
            }
        }
    }

    // MARK: Keys

    private var keys: some View {
        VStack(spacing: 11) {
            ForEach(Array((model.symbols ? symbolRows : letters).enumerated()), id: \.offset) { i, row in
                HStack(spacing: 6) {
                    if i == 1 && !model.symbols { Spacer().frame(width: 14) }
                    if i == 2 {
                        Key(systemImage: model.capsLock ? "capslock.fill" : model.shifted ? "shift.fill" : "shift",
                            style: model.shifted || model.capsLock ? .shiftOn : .function, width: 44) {
                            model.shiftTapped()
                        }
                        Spacer().frame(width: 6)
                    }
                    ForEach(row, id: \.self) { c in
                        Key(label: model.shifted || model.capsLock ? String(c).uppercased() : String(c), style: .letter) {
                            model.letter(c)
                        }
                    }
                    if i == 1 && !model.symbols { Spacer().frame(width: 14) }
                    if i == 2 {
                        Spacer().frame(width: 6)
                        Key(systemImage: "delete.left", style: .function, width: 44, repeats: true) { model.delete() }
                    }
                }
            }
            HStack(spacing: 6) {
                Key(label: model.symbols ? "ABC" : "123", style: .function, width: needsGlobe ? 44 : 92) {
                    model.symbols.toggle()
                }
                if needsGlobe {
                    Key(systemImage: "globe", style: .function, width: 42, action: nextKeyboard)
                }
                Key(label: "space", style: .letter) { model.space() }
                Key(systemImage: "return", style: .function, width: 92) { model.returnKey() }
            }
        }
    }
}

private struct Key: View {
    enum Style { case letter, function, shiftOn }

    var label: String? = nil
    var systemImage: String? = nil
    var style: Style
    var width: CGFloat? = nil
    var repeats = false
    var action: () -> Void

    @State private var timer: Timer?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8)
                .fill(background)
                .shadow(color: .black.opacity(0.3), radius: 0, y: 1)
            if let label {
                Text(label).font(label.count == 1 ? .system(size: 23) : .system(size: 16))
            } else if let systemImage {
                Image(systemName: systemImage).font(.system(size: 18))
            }
        }
        .foregroundStyle(style == .shiftOn ? Color.black : Color.primary)
        .frame(width: width)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .frame(height: 44)
        .contentShape(Rectangle())
        .onTapGesture {
            UIDevice.current.playInputClick()
            UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.5)
            action()
        }
        .onLongPressGesture(minimumDuration: 0.4, pressing: { down in
            guard repeats else { return }
            timer?.invalidate()
            timer = down ? Timer.scheduledTimer(withTimeInterval: 0.09, repeats: true) { _ in
                MainActor.assumeIsolated { action() }
            } : nil
        }, perform: {})
    }

    private var background: Color {
        switch style {
        case .letter: Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.42, alpha: 1) : .white })
        case .function: Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 0.26, alpha: 1) : UIColor(white: 0.68, alpha: 1) })
        case .shiftOn: .white
        }
    }
}
