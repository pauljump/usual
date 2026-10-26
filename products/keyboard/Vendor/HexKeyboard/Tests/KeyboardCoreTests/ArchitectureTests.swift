import Foundation
import Testing

struct ArchitectureTests {
    @Test func coreImportsNothing() throws {
        let core = URL(filePath: #filePath).deletingLastPathComponent().appending(path: "../../Sources/KeyboardCore").standardized
        let files = try #require(FileManager.default.enumerator(at: core, includingPropertiesForKeys: nil)?.allObjects as? [URL])
        let sources = files.filter { $0.pathExtension == "swift" }
        #expect(sources.count > 20)
        for file in sources {
            let imports = try String(contentsOf: file, encoding: .utf8).split(separator: "\n").filter { $0.hasPrefix("import ") }
            #expect(imports.isEmpty, "\(file.lastPathComponent): \(imports)")
        }
    }
}
