/// Where your taps for each key really land, learned from every labeled tap.
///
/// Each key's taps are a 2D Gaussian with unknown mean and covariance under a Normal-Inverse-Wishart prior, so every
/// labeled tap is a closed-form conjugate update and the likelihood of a new tap is the posterior predictive
/// Student-t. A key's mean starts at the drawn center, worth one tap (κ₀ = 1). Its spread starts at your spread over
/// all keys of its kind (letters, or the space bar), which itself starts at the drawn key cell being ±2σ; each prior
/// is worth ν₀ = 10 taps, which says people's tap spread is known to about ±30%. So the first taps anywhere teach every
/// key how steady you are, and each key's own taps move its center and shape.
///
/// Where you aim also moves (a new case, another grip, a habit), so each key's center is remembered three ways: over
/// all its taps, over about its last 30, and over about its last 3 (older taps fade by 1 − 1/n with each new one).
/// The key aims where the three agree, weighted by how well each predicted the key's taps so far: a Bayesian average
/// in which any memory can take over at any tap (fixed share, 1 in 100). While you aim the same way, all taps predict
/// best and carry the key; when the same miss comes two or three times running, the last 3 predicted it and the key
/// moves, and two good taps move it back.
///
/// Offsets are in key cells, so a model survives small width changes; each layout signature (device class,
/// orientation, layer) keeps its own keys.
///
/// `recent` keeps each key's last taps for showing you where they land. The model never reads it, and it holds no
/// order across keys, so it can't spell out what you typed.
public struct TouchModel: Codable, Hashable, Sendable {
    private var layouts: [String: [String: KeyTouches]] = [:]
    private(set) var recent: [String: [String: [Offset]]] = [:]

    static let priorSpread = 0.2
    static let priorWeight = 10.0
    static let recentTaps = 48
    static let lately = 30.0
    static let now = 3.0
    static let switching = 0.01

    public init() {}

    public init(from decoder: any Swift.Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        layouts = try container.decode([String: [String: KeyTouches]].self, forKey: .layouts)
        recent = try container.decodeIfPresent([String: [String: [Offset]]].self, forKey: .recent) ?? [:]
    }

    public var isEmpty: Bool { layouts.isEmpty }

    public func taps(for label: String, on grid: KeyGrid) -> Int {
        Int(layouts[grid.signature]?[label]?.count ?? 0)
    }

    public mutating func learn(_ samples: some Sequence<TapSample>, on grid: KeyGrid) {
        var model = layout(grid)
        for sample in samples {
            guard let (u, v) = model.learn(sample) else { continue }
            var taps = recent[grid.signature, default: [:]][sample.intended, default: []]
            taps.append(Offset(x: (u * 1000).rounded() / 1000, y: (v * 1000).rounded() / 1000))
            recent[grid.signature, default: [:]][sample.intended] = Array(taps.suffix(Self.recentTaps))
        }
        if !model.keys.isEmpty { layouts[grid.signature] = model.keys }
    }

    /// The layouts you've typed on, most taps first.
    public var signatures: [(signature: String, taps: Int)] {
        layouts.map { ($0.key, Int($0.value.values.reduce(0) { $0 + $1.count })) }.sorted { $0.taps > $1.taps }
    }

    /// The model for one keyboard layout, with the shared spreads worked out once.
    public func layout(_ grid: KeyGrid) -> Layout {
        Layout(grid: grid, keys: layouts[grid.signature] ?? [:])
    }

    public func logLikelihood(x: Double, y: Double, for label: String, on grid: KeyGrid) -> Double? {
        layout(grid).logLikelihood(x: x, y: y, for: label)
    }

    public func center(of label: String, on grid: KeyGrid) -> (x: Double, y: Double) {
        layout(grid).center(of: label)
    }

    static func offset(x: Double, y: Double, in cell: Rect) -> (Double, Double) {
        ((x - cell.midX) / cell.width, (y - cell.midY) / cell.height)
    }

    public struct Layout {
        let grid: KeyGrid
        private(set) var keys: [String: KeyTouches]
        private var letters: Spread
        private var space: Spread

        init(grid: KeyGrid, keys: [String: KeyTouches]) {
            self.grid = grid
            self.keys = keys
            letters = Spread(pooling: keys.lazy.filter { $0.key != " " }.map(\.value.all))
            space = Spread(pooling: keys[" "].map { [$0.all] } ?? [])
        }

        /// Learns one tap, as `TouchModel.learn` would on this layout's grid, and returns its offset in key cells.
        @discardableResult
        mutating func learn(_ sample: TapSample) -> (Double, Double)? {
            guard let frame = grid.frame(of: sample.intended) else { return nil }
            let (u, v) = TouchModel.offset(x: sample.tap.x, y: sample.tap.y, in: grid.cell(of: frame))
            keys[sample.intended, default: KeyTouches()].add(u, v, spread: spread(sample.intended))
            pool(sample.intended)
            return (u, v)
        }

        /// Counts a tap toward how steady you are and where the key centers over all its taps, leaving how you've
        /// aimed lately as it was: the decoder trying one reading of a word.
        mutating func suppose(_ sample: TapSample) {
            guard let frame = grid.frame(of: sample.intended) else { return }
            let (u, v) = TouchModel.offset(x: sample.tap.x, y: sample.tap.y, in: grid.cell(of: frame))
            keys[sample.intended, default: KeyTouches()].suppose(u, v)
            pool(sample.intended)
        }

        private mutating func pool(_ label: String) {
            if label == " " {
                space = Spread(pooling: keys[" "].map { [$0.all] } ?? [])
            } else {
                letters = Spread(pooling: keys.lazy.filter { $0.key != " " }.map(\.value.all))
            }
        }

        /// Log density, per square point, of a tap at (x, y) when you meant the key labeled `label`.
        public func logLikelihood(x: Double, y: Double, for label: String) -> Double? {
            guard let frame = grid.frame(of: label) else { return nil }
            let cell = grid.cell(of: frame)
            let (u, v) = TouchModel.offset(x: x, y: y, in: cell)
            return posterior(label).logPredictive(u, v) - Math.log(cell.width * cell.height)
        }

        /// The learned center of a key's taps, in key cells from the drawn center.
        public func center(of label: String) -> (x: Double, y: Double) {
            posterior(label).mean
        }

        func posterior(_ label: String) -> Posterior {
            (keys[label] ?? KeyTouches()).posterior(spread(label))
        }

        private func spread(_ label: String) -> Spread {
            label == " " ? space : letters
        }
    }
}

/// One key's taps, and where its latest ones center, with the probability that each memory (all taps, lately, now)
/// predicts the key's next tap best.
struct KeyTouches: Codable, Hashable, Sendable {
    private(set) var all = Touches()
    private(set) var lately = Drift()
    private(set) var now = Drift()
    private(set) var weights = SIMD3<Double>(repeating: 1.0 / 3)

    var count: Double { all.count }

    init() {}

    /// A key saved before it remembered how you aim lately starts both drifts where all its taps center.
    init(from decoder: any Swift.Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        guard let all = try container.decodeIfPresent(Touches.self, forKey: .all) else {
            all = try Touches(from: decoder)
            lately = Drift(all, memory: TouchModel.lately)
            now = Drift(all, memory: TouchModel.now)
            return
        }
        self.all = all
        lately = try container.decode(Drift.self, forKey: .lately)
        now = try container.decode(Drift.self, forKey: .now)
        weights = try container.decode(SIMD3<Double>.self, forKey: .weights)
    }

    func memories(_ spread: Spread) -> (all: Posterior, lately: Posterior, now: Posterior) {
        let all = Posterior(self.all, spread: spread)
        return (all, all.aiming(lately), all.aiming(now))
    }

    /// The three memories as one posterior with their weighted mean and spread.
    func posterior(_ spread: Spread) -> Posterior {
        let (all, lately, now) = memories(spread)
        return Posterior(blending: all, lately, now, by: weights)
    }

    mutating func suppose(_ u: Double, _ v: Double) {
        all.add(u, v)
    }

    /// Reweighs each memory by how well it predicted this tap, keeping a share for each so any can take over, then
    /// learns the tap.
    mutating func add(_ u: Double, _ v: Double, spread: Spread) {
        let (all, lately, now) = memories(spread)
        let scores = SIMD3(all.logPredictive(u, v), lately.logPredictive(u, v), now.logPredictive(u, v))
        let best = scores.max()
        var odds = weights
        for i in odds.indices { odds[i] *= Math.exp(scores[i] - best) }
        weights = (1 - TouchModel.switching) * odds / odds.sum() + TouchModel.switching / 3
        suppose(u, v)
        self.lately.add(u, v, memory: TouchModel.lately)
        self.now.add(u, v, memory: TouchModel.now)
    }
}

/// Where a key's latest taps center, each older tap fading by 1 − 1/memory, so it holds about `memory` taps.
struct Drift: Codable, Hashable, Sendable {
    private(set) var count = 0.0
    private(set) var x = 0.0, y = 0.0

    init() {}

    init(_ touches: Touches, memory: Double) {
        (count, x, y) = (min(touches.count, memory), touches.meanX, touches.meanY)
    }

    mutating func add(_ u: Double, _ v: Double, memory: Double) {
        count = count * (1 - 1 / memory) + 1
        x += (u - x) / count
        y += (v - y) / count
    }
}

/// The expected covariance of a group of keys' taps around their own centers, starting from the drawn cell.
struct Spread {
    let xx, xy, yy: Double

    init(pooling keys: some Sequence<Touches>) {
        let weight = TouchModel.priorWeight - 3
        let prior = weight * TouchModel.priorSpread * TouchModel.priorSpread
        var (xx, xy, yy, count) = (prior, 0.0, prior, 0.0)
        for key in keys {
            let shrink = key.count / (1 + key.count)
            xx += key.scatterXX + shrink * key.meanX * key.meanX
            xy += key.scatterXY + shrink * key.meanX * key.meanY
            yy += key.scatterYY + shrink * key.meanY * key.meanY
            count += key.count
        }
        let scale = 1 / (weight + count)
        (self.xx, self.xy, self.yy) = (xx * scale, xy * scale, yy * scale)
    }
}

struct Offset: Codable, Hashable, Sendable {
    var x, y: Double
}

struct Touches: Codable, Hashable, Sendable {
    private(set) var count = 0.0
    private(set) var meanX = 0.0, meanY = 0.0
    private(set) var scatterXX = 0.0, scatterXY = 0.0, scatterYY = 0.0

    mutating func add(_ x: Double, _ y: Double) {
        count += 1
        let dx = x - meanX, dy = y - meanY
        meanX += dx / count
        meanY += dy / count
        scatterXX += dx * (x - meanX)
        scatterXY += dx * (y - meanY)
        scatterYY += dy * (y - meanY)
    }
}

struct Posterior {
    let mean: (x: Double, y: Double)
    let kappa, dof: Double
    let xx, xy, yy: Double

    init(_ touches: Touches, spread: Spread) {
        let n = touches.count
        let kappa = 1 + n, nu = TouchModel.priorWeight + n
        let weight = TouchModel.priorWeight - 3
        let shrink = n / kappa
        mean = (shrink * touches.meanX, shrink * touches.meanY)
        let psiXX = weight * spread.xx + touches.scatterXX + shrink * touches.meanX * touches.meanX
        let psiXY = weight * spread.xy + touches.scatterXY + shrink * touches.meanX * touches.meanY
        let psiYY = weight * spread.yy + touches.scatterYY + shrink * touches.meanY * touches.meanY
        self.kappa = kappa
        dof = nu - 1
        let scale = (kappa + 1) / (kappa * dof)
        (xx, xy, yy) = (psiXX * scale, psiXY * scale, psiYY * scale)
    }

    private init(mean: (x: Double, y: Double), kappa: Double, dof: Double, xx: Double, xy: Double, yy: Double) {
        (self.mean, self.kappa, self.dof, self.xx, self.xy, self.yy) = (mean, kappa, dof, xx, xy, yy)
    }

    /// One posterior with the weighted mean and spread of three that share their degrees of freedom.
    init(blending a: Posterior, _ b: Posterior, _ c: Posterior, by weights: SIMD3<Double>) {
        let mean = (x: (weights * SIMD3(a.mean.x, b.mean.x, c.mean.x)).sum(), y: (weights * SIMD3(a.mean.y, b.mean.y, c.mean.y)).sum())
        let dx = SIMD3(a.mean.x, b.mean.x, c.mean.x) - mean.x, dy = SIMD3(a.mean.y, b.mean.y, c.mean.y) - mean.y
        let toScale = (a.dof - 2) / a.dof
        self.init(mean: mean, kappa: a.kappa, dof: a.dof,
                  xx: (weights * (SIMD3(a.xx, b.xx, c.xx) + toScale * dx * dx)).sum(),
                  xy: (weights * (SIMD3(a.xy, b.xy, c.xy) + toScale * dx * dy)).sum(),
                  yy: (weights * (SIMD3(a.yy, b.yy, c.yy) + toScale * dy * dy)).sum())
    }

    /// The same steadiness around where your latest taps center, with this posterior's mean as their prior (one tap).
    func aiming(_ drift: Drift) -> Posterior {
        let kappa = 1 + drift.count
        let mean = ((self.mean.x + drift.count * drift.x) / kappa, (self.mean.y + drift.count * drift.y) / kappa)
        let rescale = (kappa + 1) / kappa * self.kappa / (self.kappa + 1)
        return Posterior(mean: mean, kappa: kappa, dof: dof, xx: xx * rescale, xy: xy * rescale, yy: yy * rescale)
    }

    func logPredictive(_ u: Double, _ v: Double) -> Double {
        let determinant = xx * yy - xy * xy
        let du = u - mean.x, dv = v - mean.y
        let distance = (yy * du * du - 2 * xy * du * dv + xx * dv * dv) / determinant
        return -Math.log(2 * Double.pi) - Math.log(determinant) / 2 - (dof / 2 + 1) * Math.log1p(distance / dof)
    }
}
