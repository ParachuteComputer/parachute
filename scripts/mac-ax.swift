// Drive the Mac app the way a person would, through macOS accessibility (the same tree VoiceOver reads), for the Mac
// workflow's sign-in smoke test (scripts/mac-smoke.sh). Only what that test needs:
//   swift scripts/mac-ax.swift <process> dump                  print the window's tree (role, title, value)
//   swift scripts/mac-ax.swift <process> wait <text> [secs]    wait until something shows <text>
//   swift scripts/mac-ax.swift <process> press <text>          press the button, link or disclosure that says <text>
//   swift scripts/mac-ax.swift <process> type <field> <text>   type into the field labelled or placeholdered <field>
// press and type wait up to 10 s for what they look for (a page may still be loading); exit 1 when it never shows.
import AppKit
import ApplicationServices

let args = CommandLine.arguments
guard args.count >= 3 else { fputs("usage: mac-ax.swift <process> dump|wait|press|type …\n", stderr); exit(2) }
guard AXIsProcessTrusted() else { fputs("this process isn't trusted for accessibility\n", stderr); exit(3) }

func app() -> AXUIElement? {
  guard let p = NSWorkspace.shared.runningApplications.first(where: { $0.executableURL?.lastPathComponent == args[1] }) else { return nil }
  return AXUIElementCreateApplication(p.processIdentifier)
}

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? {
  var v: AnyObject?
  return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}
func str(_ e: AXUIElement, _ name: String) -> String { (attr(e, name) as? String) ?? "" }
func children(_ e: AXUIElement) -> [AXUIElement] { (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }

/// Every element under the app's windows, depth first.
func all() -> [AXUIElement] {
  guard let a = app() else { return [] }
  var out: [AXUIElement] = []
  func walk(_ e: AXUIElement, _ depth: Int) {
    out.append(e)
    if depth < 60 { children(e).forEach { walk($0, depth + 1) } }
  }
  ((attr(a, kAXWindowsAttribute) as? [AXUIElement]) ?? []).forEach { walk($0, 0) }
  return out
}

/// What an element says: its title, description, value, or the text inside it.
func says(_ e: AXUIElement) -> [String] {
  var s = [str(e, kAXTitleAttribute), str(e, kAXDescriptionAttribute), str(e, kAXValueAttribute)]
  if str(e, kAXRoleAttribute) != "AXStaticText" {
    s.append(children(e).filter { str($0, kAXRoleAttribute) == "AXStaticText" }.map { str($0, kAXValueAttribute) }.joined())
  }
  return s.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
}

func find(_ text: String, roles: Set<String>? = nil) -> AXUIElement? {
  all().first { e in (roles == nil || roles!.contains(str(e, kAXRoleAttribute))) && says(e).contains(text) }
}

/// Look again until `secs` have passed.
func soon<T>(within secs: Double = 10, _ look: () -> T?) -> T? {
  let until = Date().addingTimeInterval(secs)
  repeat {
    if let found = look() { return found }
    usleep(250_000)
  } while Date() < until
  return nil
}

func typeText(_ text: String) {
  let src = CGEventSource(stateID: .hidSystemState)
  for ch in text.utf16 {
    var c = ch
    for down in [true, false] {
      let ev = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: down)!
      ev.keyboardSetUnicodeString(stringLength: 1, unicodeString: &c)
      ev.post(tap: .cghidEventTap)
    }
    usleep(8000)
  }
}

switch args[2] {
case "dump":
  for e in all() {
    let role = str(e, kAXRoleAttribute)
    let s = says(e).joined(separator: " | ")
    if !s.isEmpty || role == "AXTextField" || role == "AXButton" { print("\(role): \(s)") }
  }
case "wait":
  let secs = args.count > 4 ? Double(args[4])! : 20
  if soon(within: secs, { find(args[3]) }) != nil { exit(0) }
  fputs("nothing shows \"\(args[3])\" after \(Int(secs)) s\n", stderr); exit(1)
case "press":
  guard let e = soon({ find(args[3], roles: ["AXButton", "AXLink", "AXDisclosureTriangle", "AXGroup", "AXCheckBox"]) }) else {
    fputs("no button or link says \"\(args[3])\"\n", stderr); exit(1)
  }
  let r = AXUIElementPerformAction(e, kAXPressAction as CFString)
  if r != .success { fputs("pressing \"\(args[3])\" failed (\(r.rawValue))\n", stderr); exit(1) }
case "type":
  let field = soon {
    all().first { f in
      (["AXTextField", "AXTextArea"].contains(str(f, kAXRoleAttribute)) || str(f, kAXSubroleAttribute) == "AXSecureTextField")
        && (says(f).contains(args[3]) || str(f, kAXPlaceholderValueAttribute) == args[3])
    }
  }
  guard let f = field else {
    fputs("no field \"\(args[3])\"\n", stderr); exit(1)
  }
  AXUIElementSetAttributeValue(f, kAXFocusedAttribute as CFString, kCFBooleanTrue)
  usleep(300_000)
  typeText(args[4])
default:
  fputs("unknown: \(args[2])\n", stderr); exit(2)
}
