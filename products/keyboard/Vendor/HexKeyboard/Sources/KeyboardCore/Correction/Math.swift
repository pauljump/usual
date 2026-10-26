// KeyboardCore can't import Foundation or libc (it also targets WebAssembly), so the two transcendental functions it needs live here.
enum Math {
    static let ln2 = 0.693_147_180_559_945_3

    static func log(_ x: Double) -> Double {
        guard x > 0 else { return x == 0 ? -.infinity : .nan }
        guard x.isFinite else { return x }
        let s = (x.significand - 1) / (x.significand + 1)
        let s2 = s * s
        var term = s, sum = 0.0, k = 1.0
        while abs(term) > 1e-17 {
            sum += term / k
            term *= s2
            k += 2
        }
        return Double(x.exponent) * ln2 + 2 * sum
    }

    static func exp(_ x: Double) -> Double {
        guard x > -745 else { return 0 }
        guard x < 709.8 else { return .infinity }
        let k = (x / ln2).rounded()
        let r = x - k * ln2
        var term = 1.0, sum = 1.0, n = 1.0
        while abs(term) > 1e-17 {
            term *= r / n
            sum += term
            n += 1
        }
        return Double(sign: .plus, exponent: Int(k), significand: 1) * sum
    }

    static func logSumExp(_ a: Double, _ b: Double) -> Double {
        let high = max(a, b)
        guard high > -.infinity else { return high }
        return high + log1p(exp(min(a, b) - high))
    }

    static func log1p(_ x: Double) -> Double {
        let u = 1 + x
        return u == 1 ? x : log(u) * x / (u - 1)
    }
}
