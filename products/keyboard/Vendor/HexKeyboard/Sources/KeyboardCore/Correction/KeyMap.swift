/// Which key a touch means, worked out off the main thread after every edit from where your taps for each key land and
/// how likely each key is next, so a touch costs a few multiplications. It holds only for the text it was made for.
public struct KeyMap: Sendable {
    let revision: Int
    let signature: String
    private let keys: [String: Entry]
    private let protectsKeyFaces: Bool

    private struct Entry: Sendable {
        let cell: Rect
        let posterior: Posterior
        let logOdds: Double
    }

    init(revision: Int, grid: KeyGrid, touches: TouchModel.Layout, next: [String: Double]?, protectsKeyFaces: Bool = false) {
        self.revision = revision
        self.protectsKeyFaces = protectsKeyFaces
        signature = grid.signature
        var keys: [String: Entry] = [:]
        for row in grid.rows {
            for item in row {
                guard let label = item.key.label, keys[label] == nil else { continue }
                keys[label] = Entry(cell: grid.cell(of: item.frame), posterior: touches.posterior(label),
                                    logOdds: next?[label.lowercased()].map(Math.log) ?? 0)
            }
        }
        self.keys = keys
    }

    /// The touch model's likelihood for each key the tap reaches, times how likely that key is next. Keys without a
    /// label (shift, delete, return…) keep exactly the taps that land on them.
    public func key(atX x: Double, y: Double, in grid: KeyGrid) -> (row: Int, key: Int)? {
        guard let nearest = grid.index(atX: x, y: y) else { return nil }
        guard grid.signature == signature, grid.rows[nearest.row][nearest.key].key.label != nil else { return nearest }
        // Predictions may help ambiguous gap taps, but must not steal a visible key's face.
        // In particular, finishing a background prediction must not change a direct tap.
        if protectsKeyFaces, grid.rows[nearest.row][nearest.key].frame.distanceSquared(toX: x, y: y) == 0 {
            return nearest
        }
        var best = nearest, bestScore = -Double.infinity
        for (r, row) in grid.rows.enumerated() {
            for (k, item) in row.enumerated() {
                guard let label = item.key.label, grid.reaches(label, x: x, y: y), let entry = keys[label] else { continue }
                let (u, v) = TouchModel.offset(x: x, y: y, in: entry.cell)
                let score = entry.posterior.logPredictive(u, v) - Math.log(entry.cell.width * entry.cell.height) + entry.logOdds
                if score > bestScore { (best, bestScore) = ((r, k), score) }
            }
        }
        return best
    }
}

extension Corrector {
    /// The key map for the next touch after `prefix` (`nil` where words aren't expected).
    func keyMap(revision: Int, after prefix: String?) -> KeyMap {
        let next = prefix.flatMap { prefix in lexicon.map { languageModel($0).next(after: prefix.lowercased()) } }
        return KeyMap(revision: revision, grid: grid, touches: memory.touches.layout(grid), next: next,
                      protectsKeyFaces: usualEnhancements)
    }
}
