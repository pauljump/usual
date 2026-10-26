public struct Rect: Hashable, Sendable {
    public var x, y, width, height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var midX: Double { x + width / 2 }
    public var midY: Double { y + height / 2 }

    func distanceSquared(toX px: Double, y py: Double) -> Double {
        let dx = max(x - px, 0, px - (x + width))
        let dy = max(y - py, 0, py - (y + height))
        return dx * dx + dy * dy
    }
}

public struct GridMetrics: Hashable, Sendable {
    public var columns, sideInset, keyGap, rowGap, keyHeight, numberRowHeight, topInset: Double
    public var margin: Margin

    public init(columns: Double, sideInset: Double, keyGap: Double, rowGap: Double, keyHeight: Double, numberRowHeight: Double, topInset: Double, margin: Margin = .none) {
        self.columns = columns
        self.sideInset = sideInset
        self.keyGap = keyGap
        self.rowGap = rowGap
        self.keyHeight = keyHeight
        self.numberRowHeight = numberRowHeight
        self.topInset = topInset
        self.margin = margin
    }

    func available(in width: Double) -> Double {
        width - margin.leading - margin.trailing - sideInset * 2 + keyGap
    }
}

public struct Margin: Hashable, Sendable {
    public var leading, trailing: Double

    public init(leading: Double = 0, trailing: Double = 0) {
        self.leading = leading
        self.trailing = trailing
    }

    public static let none = Margin()
}

public struct KeyGrid: Sendable {
    public private(set) var rows: [[(key: Key, frame: Rect)]] = []
    public private(set) var signature = ""
    public private(set) var width = 0.0
    private var bands: [ClosedRange<Double>] = []
    private var metrics = GridMetrics(columns: 1, sideInset: 0, keyGap: 0, rowGap: 0, keyHeight: 1, numberRowHeight: 1, topInset: 0)
    private var labels: [String: (row: Int, key: Int)] = [:]

    public init() {}

    public init(_ layout: KeyboardLayout, width: Double, metrics: GridMetrics, signature: String = "") {
        self.metrics = metrics
        self.signature = signature
        self.width = width
        let available = metrics.available(in: width)
        let pitch = available / metrics.columns
        var y = metrics.topInset
        for (index, row) in layout.rows.enumerated() {
            let height = layout.hasNumberRow && index == 0 ? metrics.numberRowHeight : metrics.keyHeight
            let fixed = row.compactMap(\.width.span).reduce(0, +)
            let fills = row.count { $0.width == .fill }
            let fillSpan = fills > 0 ? max(available / pitch - fixed, 0) / Double(fills) : 0
            var x = metrics.margin.leading + metrics.sideInset - metrics.keyGap / 2
            var keys: [(key: Key, frame: Rect)] = []
            for item in row {
                let span = (item.width.span ?? fillSpan) * pitch
                if case .key(let key) = item {
                    keys.append((key, Rect(x: x + metrics.keyGap / 2, y: y, width: span - metrics.keyGap, height: height)))
                }
                x += span
            }
            let top = index == 0 ? -Double.infinity : y - metrics.rowGap / 2
            let bottom = index == layout.rows.count - 1 ? Double.infinity : y + height + metrics.rowGap / 2
            for (index, key) in keys.enumerated() {
                if let label = key.key.label { labels[label] = labels[label] ?? (rows.count, index) }
            }
            rows.append(keys)
            bands.append(top...bottom)
            y += height + metrics.rowGap
        }
    }

    public func index(atX x: Double, y: Double) -> (row: Int, key: Int)? {
        guard let row = bands.firstIndex(where: { $0.contains(y) }),
              let key = rows[row].indices.min(by: { rows[row][$0].frame.distanceSquared(toX: x, y: y) < rows[row][$1].frame.distanceSquared(toX: x, y: y) })
        else { return nil }
        return (row, key)
    }

    /// The chevron a one-handed keyboard draws in its margin to bring both hands back, as Apple places it: 40pt in from
    /// the screen's edge (27.67pt toward the right hand) and 13/3pt below the middle of the keys.
    public var expander: (frame: Rect, pointsRight: Bool)? {
        guard metrics.margin != .none, let top = rows.first?.first?.frame.y, let bottom = rows.last?.first?.frame else { return nil }
        let size = Size(width: 34.0 / 3, height: 107.0 / 3)
        let pointsRight = metrics.margin.trailing > 0
        let midY = (top + bottom.y + bottom.height) / 2 + 13.0 / 3
        return (Rect(x: pointsRight ? width - 40 : 83.0 / 3, y: midY - size.height / 2, width: size.width, height: size.height), pointsRight)
    }

    public func key(atX x: Double, y: Double) -> Key? {
        index(atX: x, y: y).map { rows[$0.row][$0.key].key }
    }

    public func index(of label: String) -> (row: Int, key: Int)? {
        labels[label]
    }

    public func frame(of label: String) -> Rect? {
        labels[label].map { rows[$0.row][$0.key].frame }
    }

    /// Whether a tap is close enough to a key to have been meant for it: within a quarter key of its cell.
    public func reaches(_ label: String, x: Double, y: Double) -> Bool {
        guard let frame = frame(of: label) else { return false }
        let cell = cell(of: frame)
        let dx = max(cell.x - x, 0, x - (cell.x + cell.width))
        let dy = max(cell.y - y, 0, y - (cell.y + cell.height))
        return dx <= pitch.x / 4 && dy <= pitch.y / 4
    }

    var pitch: (x: Double, y: Double) {
        (metrics.available(in: width) / metrics.columns, metrics.keyHeight + metrics.rowGap)
    }

    func cell(of frame: Rect) -> Rect {
        Rect(x: frame.x - metrics.keyGap / 2, y: frame.y - metrics.rowGap / 2, width: frame.width + metrics.keyGap, height: frame.height + metrics.rowGap)
    }

    var bounds: Rect {
        let cells = rows.joined().map { cell(of: $0.frame) }
        guard let first = cells.first else { return Rect(x: 0, y: 0, width: 1, height: 1) }
        let minX = cells.map(\.x).min() ?? first.x, minY = cells.map(\.y).min() ?? first.y
        let maxX = cells.map { $0.x + $0.width }.max() ?? 1, maxY = cells.map { $0.y + $0.height }.max() ?? 1
        return Rect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }
}

extension KeyGrid {
    /// The iPhone letter layout measured in key pitches, for decoding words typed without tap positions.
    public static let standard = KeyGrid(
        Layouts.layout(for: LayoutContext(device: .phone, layer: .letters)),
        width: 10,
        metrics: GridMetrics(columns: 10, sideInset: 0, keyGap: 0, rowGap: 0, keyHeight: 1, numberRowHeight: 1, topInset: 0),
        signature: "standard"
    )
}

extension Key {
    public var label: String? {
        switch action {
        case .space: " "
        case .character(let value) where value.count == 1 && value.allSatisfy(Words.isWordCharacter): value
        default: nil
        }
    }
}
