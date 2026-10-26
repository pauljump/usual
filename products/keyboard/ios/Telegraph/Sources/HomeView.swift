import SwiftUI

/// Try the same flow as the keyboard: key words in, readings when Jev isn't sure, the
/// written result out. Also the setup steps for the keyboard.
struct HomeView: View {
    @State private var keys = ""
    @State private var size: MiniClient.Size = .line
    @State private var readings: MiniClient.Readings?
    @State private var result: MiniClient.Written?
    @State private var busy: String?
    @State private var error: String?
    @FocusState private var typing: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Type a messy draft here", text: $keys, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($typing)
                    Picker("Length", selection: $size) {
                        ForEach(MiniClient.Size.allCases) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    Button {
                        Task { await expand() }
                    } label: {
                        if let busy { Label(busy, systemImage: "hourglass") } else { Label("Expand", systemImage: "sparkles") }
                    }
                    .disabled(keys.trimmingCharacters(in: .whitespaces).isEmpty || busy != nil)
                } footer: {
                    Text("Tap or swipe through an English word, then lift. Tap a suggestion to change a swiped word; backspace removes it in one press. Use Finish above the keys to fix your draft. Rephrase keeps the meaning in your voice; Expand turns key words into a line, paragraph or brief. Swipe can be turned off under Expand › Typing.")
                }

                if let error {
                    Section { Text(error).foregroundStyle(.orange) }
                }

                if let r = readings, result == nil {
                    Section("Which did you mean?") {
                        ForEach(Array(r.ranked.enumerated()), id: \.offset) { _, item in
                            Button {
                                Task { await write(item.text) }
                            } label: {
                                HStack(alignment: .top) {
                                    Text(item.text).foregroundStyle(.primary)
                                    Spacer()
                                    Text(String(format: "%.0f%%", item.score.meant * 100))
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .disabled(busy != nil)
                        }
                    }
                }

                if let result {
                    Section {
                        Text(result.text).textSelection(.enabled)
                        HStack {
                            Button("Copy") { UIPasteboard.general.string = result.text }
                            Spacer()
                            ShareLink(item: result.text)
                        }
                    } header: {
                        Text("\(result.text.split(separator: " ").count) words · \(String(format: "%.1f", Double(result.ms) / 1000)) s")
                    }
                }

                Section("Use it as your keyboard") {
                    Label("Settings › General › Keyboard › Keyboards › Add New Keyboard › Usual", systemImage: "1.circle")
                    Label("Tap Usual there and turn on Allow Full Access, so it can reach your Mini", systemImage: "2.circle")
                    Label("In any app, choose Usual with 🌐. Type freely, then tap Finish above the keys.", systemImage: "3.circle")
                    Button("Open Settings") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
                }

                Section {
                    Text("Typing and personal autocorrect work offline. Finish, Rephrase and Expand need Full Access and Tailscale. Your draft and relevant past words go through your Mini to Haiku; Rephrase and Expand also use Jev. No provider keys are stored on your phone. For a long draft written in another keyboard, select the whole draft before Finish. Undo restores the previous text before you keep typing.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Usual")
            .onAppear {
                if ProcessInfo.processInfo.arguments.contains("-practice") { typing = true }
            }
        }
    }

    private func expand() async {
        let k = keys.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !k.isEmpty, busy == nil else { return }
        typing = false
        error = nil
        result = nil
        readings = nil
        busy = "Reading your key words…"
        do {
            let r = try await MiniClient.readings(keys: k, before: "")
            readings = r
            busy = nil
            if r.sure, let i = r.choice, r.readings.indices.contains(i) { await write(r.readings[i]) }
        } catch {
            self.error = error.localizedDescription
            busy = nil
        }
    }

    private func write(_ reading: String) async {
        busy = "Writing it out…"
        defer { busy = nil }
        do {
            result = try await MiniClient.write(keys: keys.trimmingCharacters(in: .whitespacesAndNewlines),
                                                reading: reading, size: size)
        } catch {
            self.error = error.localizedDescription
        }
    }
}
