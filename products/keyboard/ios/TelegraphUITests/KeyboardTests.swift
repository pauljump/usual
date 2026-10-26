import XCTest

@MainActor final class KeyboardTests: XCTestCase {
    func testTypingSurface() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-practice"]
        app.launch()
        // A fresh shared simulator can show Apple's first-use keyboard sheet.
        let welcome = app.buttons["Continue"]
        if welcome.waitForExistence(timeout: 2) { welcome.tap() }
        app.textFields.firstMatch.tap()
        let firstGlobe = app.buttons.matching(NSPredicate(format: "label == 'Next keyboard' OR label == 'Emoji'")).firstMatch
        if firstGlobe.waitForExistence(timeout: 5) {
            firstGlobe.press(forDuration: 1)
            let settingsLink = app.cells["Keyboard Settings…"]
            if settingsLink.waitForExistence(timeout: 3) { settingsLink.tap() }
            let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
            settings.activate()
            let keyboards = settings.cells["KEYBOARDS"]
            if keyboards.waitForExistence(timeout: 3) { keyboards.tap() }
            let addKeyboard = settings.cells["AddNewKeyboard"]
            if addKeyboard.waitForExistence(timeout: 3) { addKeyboard.tap() }
            let usual = settings.staticTexts["Usual"].firstMatch
            if usual.waitForExistence(timeout: 3) { usual.tap() }
            print("SETTINGS_AX_BEGIN\n" + settings.debugDescription + "\nSETTINGS_AX_END")
            app.activate()
            app.textFields.firstMatch.tap()
        }
        let finish = app.buttons["usual.finish"]
        if !finish.waitForExistence(timeout: 3) {
            let globe = app.buttons.matching(NSPredicate(format: "label == 'Next keyboard' OR label == 'Emoji'")).firstMatch
            if globe.exists { globe.press(forDuration: 1) }
            let choice = app.cells.matching(NSPredicate(format: "label CONTAINS[c] 'Usual'")).firstMatch
            if choice.waitForExistence(timeout: 3) { choice.tap() }
        }
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "Usual keyboard"; shot.lifetime = .keepAlways; add(shot)
        print("USUAL_AX_BEGIN\n" + app.debugDescription + "\nUSUAL_AX_END")
        XCTAssertTrue(finish.waitForExistence(timeout: 5), "Usual keyboard must be enabled in this simulator")
        guard finish.exists else { return }
        XCTAssertTrue(app.buttons["usual.rephrase"].exists)
        XCTAssertTrue(app.buttons["usual.expand"].exists)
        for letter in "hello" {
            let key = app.keys["hex.\(letter)"]
            XCTAssertTrue(key.exists)
            key.tap()
        }
        XCTAssertEqual(app.textFields.firstMatch.value as? String, "Hello")
        // A real UIKit drag through the installed extension, not a direct decoder call.
        let start = app.keys["hex.t"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        let end = app.keys["hex.o"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.08, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.05)
        let swiped = NSPredicate(format: "value == %@", "Hello to ")
        expectation(for: swiped, evaluatedWith: app.textFields.firstMatch)
        waitForExpectations(timeout: 5)
        // Commit a typo through real key taps, so an enabled setting alone cannot pass.
        for letter in "teh" { app.keys["hex.\(letter)"].tap() }
        app.keys["hex.space"].tap()
        let corrected = NSPredicate(format: "value == %@", "Hello to the ")
        expectation(for: corrected, evaluatedWith: app.textFields.firstMatch)
        waitForExpectations(timeout: 5)
        let typed = XCTAttachment(screenshot: app.screenshot())
        typed.name = "Tap, swipe and automatic typo correction"; typed.lifetime = .keepAlways; add(typed)
    }
}
