import UIKit
import KeyboardCore

final class CalloutView: UIView {
    private let shape = CAShapeLayer()
    private let label = UILabel()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        layer.addSublayer(shape)
        shape.shadowOffset = CGSize(width: 0, height: 1)
        shape.shadowRadius = 2.5
        shape.shadowOpacity = 1
        label.textAlignment = .center
        addSubview(label)
    }

    required init?(coder: NSCoder) { fatalError() }

    func show(_ text: String, over key: CGRect, in area: CGRect, metrics: KeyboardMetrics, theme: KeyboardTheme) {
        let bubble = Self.bubbleRect(for: key, in: area)
        frame = bubble.union(key)
        let local = { (rect: CGRect) in rect.offsetBy(dx: -self.frame.minX, dy: -self.frame.minY) }
        shape.path = Self.path(bubble: local(bubble), key: local(key), radius: metrics.cornerRadius)
        shape.fillColor = theme.key.ui.cgColor
        shape.shadowColor = theme.shadow.ui.cgColor
        label.text = text
        label.textColor = theme.label.ui
        label.font = .systemFont(ofSize: metrics.letterSize * 1.55, weight: .regular)
        label.frame = local(bubble).offsetBy(dx: 0, dy: -metrics.keyHeight * 0.06)
        isHidden = false
    }

    func hide() {
        isHidden = true
    }

    static func bubbleRect(for key: CGRect, in area: CGRect) -> CGRect {
        let spread = key.width * 0.32
        let height = key.height * 1.22
        let neck = key.height * 0.3
        var bubble = CGRect(x: key.minX - spread, y: key.minY - neck - height, width: key.width + spread * 2, height: height)
        bubble.origin.x = min(max(bubble.minX, area.minX + 1), area.maxX - bubble.width - 1)
        bubble.origin.y = max(bubble.minY, area.minY + 1)
        return bubble
    }

    static func path(bubble: CGRect, key: CGRect, radius: CGFloat) -> CGPath {
        let path = UIBezierPath()
        let r = radius
        let bubbleRadius = radius * 1.4
        let shoulder = bubble.maxY
        let neckTop = max(key.minY, shoulder + r)

        path.move(to: CGPoint(x: key.minX + r, y: key.maxY))
        path.addArc(withCenter: CGPoint(x: key.minX + r, y: key.maxY - r), radius: r, startAngle: .pi / 2, endAngle: .pi, clockwise: true)
        path.addLine(to: CGPoint(x: key.minX, y: neckTop))
        path.addCurve(
            to: CGPoint(x: bubble.minX, y: shoulder - bubbleRadius),
            controlPoint1: CGPoint(x: key.minX, y: neckTop - (neckTop - shoulder) * 0.6),
            controlPoint2: CGPoint(x: bubble.minX, y: shoulder + (neckTop - shoulder) * 0.2)
        )
        path.addLine(to: CGPoint(x: bubble.minX, y: bubble.minY + bubbleRadius))
        path.addArc(withCenter: CGPoint(x: bubble.minX + bubbleRadius, y: bubble.minY + bubbleRadius), radius: bubbleRadius, startAngle: .pi, endAngle: .pi * 1.5, clockwise: true)
        path.addLine(to: CGPoint(x: bubble.maxX - bubbleRadius, y: bubble.minY))
        path.addArc(withCenter: CGPoint(x: bubble.maxX - bubbleRadius, y: bubble.minY + bubbleRadius), radius: bubbleRadius, startAngle: .pi * 1.5, endAngle: 0, clockwise: true)
        path.addLine(to: CGPoint(x: bubble.maxX, y: shoulder - bubbleRadius))
        path.addCurve(
            to: CGPoint(x: key.maxX, y: neckTop),
            controlPoint1: CGPoint(x: bubble.maxX, y: shoulder + (neckTop - shoulder) * 0.2),
            controlPoint2: CGPoint(x: key.maxX, y: neckTop - (neckTop - shoulder) * 0.6)
        )
        path.addLine(to: CGPoint(x: key.maxX, y: key.maxY - r))
        path.addArc(withCenter: CGPoint(x: key.maxX - r, y: key.maxY - r), radius: r, startAngle: 0, endAngle: .pi / 2, clockwise: true)
        path.close()
        return path.cgPath
    }
}
