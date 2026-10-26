/// How your taps for one key land, as the touch model has learned them: where they center, how they spread, and
/// which keys they hit. Points are in the grid's coordinates.
public struct Aim: Sendable {
    public let key: Key
    public let frame: Rect
    public let taps: Int
    public let center: (x: Double, y: Double)
    /// The covariance of one tap around `center`, in square points.
    public let spread: (xx: Double, xy: Double, yy: Double)
    public let recent: [(x: Double, y: Double)]
    /// The keys under your taps for this key, by the share of taps each would get from geometry alone, largest first.
    public let landing: [(key: Key, share: Double)]

    public var onTarget: Double { landing.first { $0.key == key }?.share ?? 0 }

    /// How far the center of your taps sits from the center of the key.
    public var drift: (x: Double, y: Double) { (center.x - frame.midX, center.y - frame.midY) }
}

extension TouchModel {
    /// Every key that learns from your taps (letters and the space bar), as it lands on this grid.
    public func aims(on grid: KeyGrid) -> [Aim] {
        let model = layout(grid)
        let taps = recent[grid.signature] ?? [:]
        return grid.rows.joined().compactMap { item in
            guard let label = item.key.label else { return nil }
            let cell = grid.cell(of: item.frame)
            let posterior = model.posterior(label)
            let center = (x: cell.midX + posterior.mean.x * cell.width, y: cell.midY + posterior.mean.y * cell.height)
            let variance: Double = posterior.dof / (posterior.dof - 2)
            let w = cell.width, h = cell.height
            let spread = (xx: posterior.xx * variance * w * w, xy: posterior.xy * variance * w * h, yy: posterior.yy * variance * h * h)
            let recent: [(x: Double, y: Double)] = (taps[label] ?? []).map { (cell.midX + $0.x * w, cell.midY + $0.y * h) }
            let count: Double = model.keys[label]?.count ?? 0
            return Aim(
                key: item.key,
                frame: item.frame,
                taps: Int(count),
                center: center,
                spread: spread,
                recent: recent,
                landing: Self.landing(around: center, spread: spread, on: grid)
            )
        }
    }

    /// Spreads a Gaussian over the grid on a lattice out to 3.5σ along its axes and asks the grid which key is under
    /// each point, the way a tap with no model behind it would be read.
    static func landing(around center: (x: Double, y: Double), spread: (xx: Double, xy: Double, yy: Double), on grid: KeyGrid) -> [(key: Key, share: Double)] {
        let l11 = spread.xx.squareRoot()
        let l21 = spread.xy / l11
        let l22 = max(spread.yy - l21 * l21, 0).squareRoot()
        let steps = 24, reach = 3.5
        var shares: [Int: Double] = [:]
        var total = 0.0
        for i in -steps...steps {
            let a = reach * Double(i) / Double(steps)
            for j in -steps...steps {
                let b = reach * Double(j) / Double(steps)
                let weight = Math.exp(-(a * a + b * b) / 2)
                guard let hit = grid.index(atX: center.x + l11 * a, y: center.y + l21 * a + l22 * b) else { continue }
                shares[hit.row * 1000 + hit.key, default: 0] += weight
                total += weight
            }
        }
        return shares
            .map { (key: grid.rows[$0.key / 1000][$0.key % 1000].key, share: $0.value / total) }
            .sorted { $0.share > $1.share }
    }
}
