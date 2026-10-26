import UIKit
import KeyboardCore

final class AlternatesView: UIView {
    private let panel = UIView()
    private let highlight = UIView()
    private var labels: [UILabel] = []
    private var cellWidth: CGFloat = 0
    private var highlightHeight: CGFloat = 0
    private let padding: CGFloat = 10
    private var labelColor = UIColor.black
    private var selectedLabelColor = UIColor.white
    private(set) var options: [String] = []
    private(set) var selectedIndex = 0

    var selected: String? { options.indices.contains(selectedIndex) ? options[selectedIndex] : nil }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        panel.layer.cornerCurve = .continuous
        panel.layer.shadowOffset = CGSize(width: 0, height: 2)
        panel.layer.shadowRadius = 8
        panel.layer.shadowOpacity = 1
        highlight.layer.cornerCurve = .continuous
        addSubview(panel)
        panel.addSubview(highlight)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ options: [String], base: String, over key: CGRect, in area: CGRect, metrics: KeyboardMetrics, theme: KeyboardTheme) {
        present(options.map { NSAttributedString(string: $0, attributes: [.font: KeyboardFont.letter(metrics.letterSize)]) },
                selected: options.firstIndex(of: base) ?? 0, cellWidth: key.width + 4, over: key, in: area, metrics: metrics, theme: theme)
        self.options = options
    }

    func show(symbols: [String], selected: Int, over key: CGRect, in area: CGRect, metrics: KeyboardMetrics, theme: KeyboardTheme) {
        let configuration = UIImage.SymbolConfiguration(pointSize: metrics.symbolSize, weight: .regular)
        present(symbols.map { NSAttributedString(attachment: NSTextAttachment(image: UIImage(systemName: $0, withConfiguration: configuration) ?? UIImage())) },
                selected: selected, cellWidth: 48, over: key, in: area, metrics: metrics, theme: theme)
        options = symbols
    }

    private func present(_ contents: [NSAttributedString], selected: Int, cellWidth: CGFloat, over key: CGRect, in area: CGRect, metrics: KeyboardMetrics, theme: KeyboardTheme) {
        labels.forEach { $0.removeFromSuperview() }
        self.cellWidth = cellWidth
        let height = key.height * 1.57
        let width = cellWidth * CGFloat(contents.count) + padding * 2
        let x = key.midX - padding - cellWidth * (CGFloat(selected) + 0.5)
        frame = CGRect(
            x: min(max(x, area.minX + 7), area.maxX - width - 7),
            y: max(key.minY - height - 3, area.minY + 1),
            width: width,
            height: height
        )
        panel.frame = bounds
        panel.layer.cornerRadius = metrics.cornerRadius * 2
        panel.layer.shadowPath = UIBezierPath(roundedRect: panel.bounds, cornerRadius: panel.layer.cornerRadius).cgPath
        panel.backgroundColor = theme.key.ui
        panel.layer.shadowColor = theme.shadow.ui.cgColor
        highlight.backgroundColor = theme.selection.ui
        highlight.layer.cornerRadius = metrics.cornerRadius * 1.25

        labels = contents.enumerated().map { index, content in
            let label = UILabel(frame: CGRect(x: padding + CGFloat(index) * cellWidth, y: 0, width: cellWidth, height: height))
            label.attributedText = content
            label.textAlignment = .center
            label.textColor = theme.label.ui
            panel.addSubview(label)
            return label
        }
        highlightHeight = key.height + 4
        labelColor = theme.label.ui
        selectedLabelColor = theme.selectionLabel.ui
        select(selected)
        isHidden = false
    }

    func track(_ point: CGPoint) {
        let local = point.x - frame.minX - padding
        select(min(max(Int(local / cellWidth), 0), options.count - 1))
    }

    func hide() {
        isHidden = true
        options = []
    }

    private func select(_ index: Int) {
        selectedIndex = index
        for (offset, view) in labels.enumerated() {
            view.textColor = offset == index ? selectedLabelColor : labelColor
        }
        highlight.frame = CGRect(x: padding + CGFloat(index) * cellWidth, y: (bounds.height - highlightHeight) / 2, width: cellWidth, height: highlightHeight)
    }
}
