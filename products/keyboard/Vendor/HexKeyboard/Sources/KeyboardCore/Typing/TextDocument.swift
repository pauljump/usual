public protocol TextDocument: AnyObject {
    var textBeforeInput: String? { get }
    var textAfterInput: String? { get }
    func insert(_ text: String)
    func deleteBackward(_ count: Int)
    func moveCursor(by offset: Int)
}
