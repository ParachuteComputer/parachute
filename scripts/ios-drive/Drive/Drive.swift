// Parachute on an iPhone, driven as a person would, through what the screen offers to VoiceOver (as scripts/mac-ax.swift
// does on the Mac): paste a secret key, sign in to a Parachute with it (the pick of vaults, the hub's Approve page),
// see the list of applets, open Rooms, allow it with Face ID, and see a room on the relay. scripts/ios-drive.sh starts
// the hub, the relay and the simulator, and passes PARACHUTE_HUB, PARACHUTE_KEY, PARACHUTE_ROOM and PARACHUTE_SHOTS.
import XCTest

final class Drive: XCTestCase {
    private let env = ProcessInfo.processInfo.environment
    private let app = XCUIApplication(bundleIdentifier: "computer.parachute.app")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() { continueAfterFailure = false }

    private func need(_ name: String) -> String {
        guard let v = env[name], !v.isEmpty else { fatalError("\(name) isn't set (scripts/ios-drive.sh sets it)") }
        return v
    }

    /// A screenshot into PARACHUTE_SHOTS (the simulator writes to the Mac's disk), and into the test's result.
    private func shot(_ name: String) {
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["PARACHUTE_SHOTS"] { try? s.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(name).png")) }
    }

    private func any(_ format: String, _ args: Any...) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: format, argumentArray: args)).firstMatch
    }

    /// Waits for words on the screen (a label or a value that holds them).
    private func wait(_ words: String, _ seconds: Double = 30, file: StaticString = #filePath, line: UInt = #line) {
        if any("label CONTAINS %@ OR value CONTAINS %@", words, words).waitForExistence(timeout: seconds) { return }
        shot("failed")
        XCTFail("\"\(words)\" never showed. On screen:\n\(app.debugDescription)", file: file, line: line)
    }

    /// Presses a button (or link, or choice) by its name.
    private func press(_ name: String, _ seconds: Double = 20, file: StaticString = #filePath, line: UInt = #line) {
        var e = app.buttons.matching(NSPredicate(format: "label == %@", name)).firstMatch
        if !e.waitForExistence(timeout: seconds) { e = any("label == %@", name) }
        guard e.waitForExistence(timeout: 2) else {
            shot("failed")
            return XCTFail("no \"\(name)\" to press. On screen:\n\(app.debugDescription)", file: file, line: line)
        }
        // the keyboard going away moves the page under the finger (a tap aimed at Continue lands on Back): let it go,
        // and bring the button on screen first
        _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 3)
        let window = app.windows.firstMatch.frame
        for _ in 0..<6 where !window.contains(CGPoint(x: e.frame.midX, y: e.frame.midY)) { app.swipeUp() }
        // the page can still move after it shows (on the iPhone the pick's Continue rose 46pt a second or two after it
        // appeared, and a tap aimed at it landed on Back): tap once the button has held its place for half a second
        var at = e.frame
        for _ in 0..<10 {
            Thread.sleep(forTimeInterval: 0.5)
            let now = e.frame
            if now == at { break }
            at = now
        }
        e.tap()
    }

    /// Presses until what it opens shows (a disclosure tapped while the page re-renders can close again).
    private func press(_ name: String, until shown: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<3 {
            press(name, file: file, line: line)
            if shown.waitForExistence(timeout: 5) { return }
        }
        shot("failed")
        XCTFail("pressing \"\(name)\" didn't open it. On screen:\n\(app.debugDescription)", file: file, line: line)
    }

    private func field(_ name: String) -> XCUIElement {
        let kinds = [XCUIElement.ElementType.textField, .secureTextField, .textView].map { $0.rawValue }
        return app.descendants(matching: .any).matching(NSPredicate(format: "elementType IN %@ AND (label == %@ OR placeholderValue == %@)", kinds, name, name)).firstMatch
    }

    /// Types into the field with this label or placeholder.
    private func type(_ field: String, _ text: String, file: StaticString = #filePath, line: UInt = #line) {
        let f = self.field(field)
        guard f.waitForExistence(timeout: 20) else {
            shot("failed")
            return XCTFail("no field \"\(field)\". On screen:\n\(app.debugDescription)", file: file, line: line)
        }
        // a webview field takes keys only once it has the focus and the keyboard is up: wait for both, check the text
        // arrived, and try again if it didn't (it sometimes doesn't, the first time)
        for _ in 0..<3 {
            f.tap()
            _ = app.keyboards.firstMatch.waitForExistence(timeout: 5)
            f.typeText(text)
            let now = (f.value as? String) ?? ""
            if !now.isEmpty && now != f.placeholderValue { return }
        }
        shot("failed")
        XCTFail("couldn't type into \"\(field)\"", file: file, line: line)
    }

    /// iOS's own questions over the app (Face ID's first use, saving a password): the answer a person gives here.
    private func answerSystem(_ seconds: Double = 3) {
        for (alert, button) in [(springboard.alerts.firstMatch, "OK"), (app.alerts.firstMatch, "OK"), (springboard.alerts.firstMatch, "Not Now"), (app.buttons["Not Now"], "Not Now")] {
            if alert.waitForExistence(timeout: seconds), alert.buttons[button].exists { alert.buttons[button].tap() }
        }
    }

    /// The page fills the screen: the bar at the foot reaches its bottom edge (src-tauri/src/lib.rs full_screen_page;
    /// UIKit's default left the page 82pt short, and on the list of applets the bar floated with the page's own colour
    /// under it). Read from the screen itself: the accessibility frames of the bar didn't move with the page.
    private func footOnTheBottom(file: StaticString = #filePath, line: UInt = #line) {
        guard let cg = XCUIScreen.main.screenshot().image.cgImage else { return XCTFail("no screenshot", file: file, line: line) }
        func colour(_ x: Int, _ y: Int) -> [Int] {
            var px = [UInt8](repeating: 0, count: 4)
            let ctx = CGContext(data: &px, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            ctx.draw(cg, in: CGRect(x: -x, y: -(cg.height - 1 - y), width: cg.width, height: cg.height))
            return px.prefix(3).map { Int($0) }
        }
        // the bottom-left corner (the bar, or the page under a floating bar) against the page beside the list
        let bottom = colour(4, cg.height - 4), page = colour(4, cg.height / 2)
        let apart = zip(bottom, page).map { abs($0 - $1) }.reduce(0, +)
        print("the foot's corner \(bottom), the page \(page): \(apart) apart")
        XCTAssertGreaterThan(apart, 8, "the screen's bottom edge is the page's colour: the bar at the foot doesn't reach it", file: file, line: line)
    }

    func testSignInAndRooms() {
        let hub = need("PARACHUTE_HUB"), key = need("PARACHUTE_KEY"), room = need("PARACHUTE_ROOM")
        let host = URL(string: hub)!.host! + ":" + String(URL(string: hub)!.port!)
        app.launch()
        wait("Make a new key", 180)  // a debug build on a busy runner can take over a minute to draw
        shot("01-first-screen")

        press("Advanced: paste a secret key", until: field("nsec1…"))
        type("nsec1…", key)
        press("Keep this key")
        answerSystem(2)
        wait("Sign in with your key")

        type("Your Parachute's address", hub)
        press("Mine")
        shot("02-add-parachute")
        press("Sign in with your key")
        wait("Which vaults on \(host) are yours?")
        shot("03-pick")
        press("Continue")
        wait("Approve Parachute?")
        shot("04-hub-approve")
        press("Approve")
        wait("write a line, see your days", 60)
        shot("05-applets")
        footOnTheBottom()

        // Rooms, in the list of applets: its card asks once; Allow asks for Face ID (keyring.rs, through LocalAuthentication)
        let rooms = any("label CONTAINS %@", "your rooms on a Buzz relay")
        XCTAssert(rooms.waitForExistence(timeout: 30), "Rooms isn't in the list of applets")
        rooms.tap()
        wait("asking for access")
        shot("06-rooms-asks")
        press("Allow")
        answerSystem(5)
        wait(room, 60)
        wait("The beans are up along the fence.", 30)
        shot("07-rooms")
    }
}
