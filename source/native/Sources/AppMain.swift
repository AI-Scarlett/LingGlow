import AppKit
import Combine
import SwiftUI

extension LingGlowBrandAssets {
    static func refinedMenuBarTemplateImage() -> NSImage {
        if let url = Bundle.main.url(forResource: "LingGlowMenuBarIcon", withExtension: "png"),
           let bundled = NSImage(contentsOf: url) {
            bundled.size = NSSize(width: 18, height: 18)
            bundled.isTemplate = false
            return bundled
        }

        let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
            NSColor.black.setStroke()

            let ribbon = NSBezierPath()
            ribbon.lineWidth = 1.55
            ribbon.lineCapStyle = .round
            ribbon.lineJoinStyle = .round
            ribbon.move(to: NSPoint(x: 8.9, y: 3.0))
            ribbon.curve(
                to: NSPoint(x: 3.1, y: 6.0),
                controlPoint1: NSPoint(x: 6.9, y: 1.8),
                controlPoint2: NSPoint(x: 3.4, y: 3.3)
            )
            ribbon.curve(
                to: NSPoint(x: 8.8, y: 9.2),
                controlPoint1: NSPoint(x: 2.5, y: 8.5),
                controlPoint2: NSPoint(x: 5.7, y: 10.0)
            )
            ribbon.curve(
                to: NSPoint(x: 14.9, y: 6.1),
                controlPoint1: NSPoint(x: 11.7, y: 10.0),
                controlPoint2: NSPoint(x: 15.5, y: 8.7)
            )
            ribbon.curve(
                to: NSPoint(x: 9.1, y: 3.0),
                controlPoint1: NSPoint(x: 14.5, y: 3.5),
                controlPoint2: NSPoint(x: 11.1, y: 1.9)
            )
            ribbon.curve(
                to: NSPoint(x: 5.8, y: 13.6),
                controlPoint1: NSPoint(x: 9.0, y: 7.2),
                controlPoint2: NSPoint(x: 7.6, y: 11.6)
            )
            ribbon.curve(
                to: NSPoint(x: 12.3, y: 13.5),
                controlPoint1: NSPoint(x: 7.6, y: 15.0),
                controlPoint2: NSPoint(x: 10.6, y: 15.0)
            )
            ribbon.curve(
                to: NSPoint(x: 9.1, y: 3.0),
                controlPoint1: NSPoint(x: 10.4, y: 11.3),
                controlPoint2: NSPoint(x: 9.1, y: 7.1)
            )
            ribbon.stroke()

            let sparkle = NSBezierPath()
            sparkle.lineWidth = 1.35
            sparkle.lineCapStyle = .round
            sparkle.move(to: NSPoint(x: 9.0, y: 6.9))
            sparkle.line(to: NSPoint(x: 9.0, y: 11.2))
            sparkle.move(to: NSPoint(x: 6.9, y: 9.05))
            sparkle.line(to: NSPoint(x: 11.1, y: 9.05))
            sparkle.stroke()

            return rect.width > 0
        }
        image.isTemplate = true
        return image
    }
}

enum LingGlowBrandAssets {
    static func appIconImage() -> NSImage {
        if let url = Bundle.main.url(forResource: "LingGlowAppIcon", withExtension: "icns"),
           let bundled = NSImage(contentsOf: url) {
            return bundled
        }
        if let url = Bundle.main.url(forResource: "LingGlowAppIcon-1024", withExtension: "png"),
           let bundled = NSImage(contentsOf: url) {
            return bundled
        }
        return NSImage(
            systemSymbolName: "sparkles.rectangle.stack.fill",
            accessibilityDescription: "灵妆"
        ) ?? NSImage(size: NSSize(width: 1024, height: 1024))
    }

    static func menuBarTemplateImage() -> NSImage {
        let image = (appIconImage().copy() as? NSImage) ?? appIconImage()
        image.size = NSSize(width: 18, height: 18)
        image.isTemplate = false
        return image
    }
}

@main
@MainActor
enum LingGlowMain {
    private static let delegate = AppDelegate()

    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.regular)
        application.delegate = delegate
        application.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private let model = StudioModel()
    private var statusItem: NSStatusItem?
    private let statusMenu = NSMenu()
    private var mainWindow: NSWindow?
    private let updateManager = LingGlowUpdateManager.shared
    private var checkUpdateMenuItem: NSMenuItem?
    private var automaticUpdateMenuItem: NSMenuItem?
    private var reminderCancellable: AnyCancellable?
    private var languageCancellable: AnyCancellable?
    private var presentingReminder = false
    private var checkingForUpdate = false
    private var downloadingUpdate = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.applicationIconImage = LingGlowBrandAssets.appIconImage()
        configureMainMenu()
        configureStatusItem()
        observeLanguageChanges()
        observeReminders()
        checkForUpdates(interactive: false)

        // LingGlow still keeps its menu-bar entry, but opening the app must
        // always create a visible desktop window so first-time users receive
        // immediate launch feedback.
        DispatchQueue.main.async { [weak self] in
            self?.showMainWindow()
        }

        Task {
            await model.connectAndRefresh()
            model.startPolling()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.stopPolling()
        // Deliberately do not call /api/shutdown: closing the UI must not tear
        // down active skin sessions or the login-agent-owned local service.
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow()
        return true
    }

    /// This app owns its NSApplication lifecycle instead of using SwiftUI's
    /// App scene, so AppKit does not synthesize the standard Edit command
    /// chain for us. Keep first-responder targets nil: the focused text field
    /// then receives Cut/Copy/Paste/Select All exactly like a normal Mac app.
    private func configureMainMenu() {
        let mainMenu = NSMenu()

        let applicationItem = NSMenuItem()
        let applicationMenu = NSMenu(title: "LingGlow")
        applicationMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("关于灵妆"),
            action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
            keyEquivalent: ""
        ))
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("隐藏灵妆"),
            action: #selector(NSApplication.hide(_:)),
            keyEquivalent: "h"
        ))
        let hideOthers = NSMenuItem(
            title: LingGlowL10n.string("隐藏其他应用"),
            action: #selector(NSApplication.hideOtherApplications(_:)),
            keyEquivalent: "h"
        )
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        applicationMenu.addItem(hideOthers)
        applicationMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("显示全部"),
            action: #selector(NSApplication.unhideAllApplications(_:)),
            keyEquivalent: ""
        ))
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("退出灵妆"),
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))
        applicationItem.submenu = applicationMenu
        mainMenu.addItem(applicationItem)

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: LingGlowL10n.string("编辑"))
        editMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("撤销"),
            action: Selector(("undo:")),
            keyEquivalent: "z"
        ))
        let redo = NSMenuItem(
            title: LingGlowL10n.string("重做"),
            action: Selector(("redo:")),
            keyEquivalent: "z"
        )
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("剪切"),
            action: #selector(NSText.cut(_:)),
            keyEquivalent: "x"
        ))
        editMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("复制"),
            action: #selector(NSText.copy(_:)),
            keyEquivalent: "c"
        ))
        editMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("粘贴"),
            action: #selector(NSText.paste(_:)),
            keyEquivalent: "v"
        ))
        editMenu.addItem(NSMenuItem(
            title: LingGlowL10n.string("全选"),
            action: #selector(NSText.selectAll(_:)),
            keyEquivalent: "a"
        ))
        editItem.submenu = editMenu
        mainMenu.addItem(editItem)

        NSApp.mainMenu = mainMenu
    }

    private func configureStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        guard let button = item.button else { return }
        button.image = LingGlowBrandAssets.refinedMenuBarTemplateImage()
        button.toolTip = LingGlowL10n.string("灵妆｜AI 助手主题与换肤")
        button.setAccessibilityLabel(LingGlowL10n.string("打开灵妆"))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.target = self
        button.action = #selector(handleStatusItemClick(_:))
        configureStatusMenu()
        statusItem = item
    }

    @objc
    private func handleStatusItemClick(_ sender: Any?) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            showStatusMenu()
            return
        }

        if event.modifierFlags.contains(.control) {
            showStatusMenu()
            return
        }

        showMainWindow()
    }

    private func configureStatusMenu() {
        statusMenu.autoenablesItems = true

        let openItem = NSMenuItem(
            title: LingGlowL10n.string("打开灵妆"),
            action: #selector(showPopoverFromMenu(_:)),
            keyEquivalent: ""
        )
        openItem.target = self

        let updateSeparator = NSMenuItem.separator()

        let checkUpdateItem = NSMenuItem(
            title: LingGlowL10n.string("检查更新…"),
            action: #selector(checkForUpdatesFromMenu(_:)),
            keyEquivalent: ""
        )
        checkUpdateItem.target = self
        checkUpdateMenuItem = checkUpdateItem

        let automaticUpdateItem = NSMenuItem(
            title: LingGlowL10n.string("自动安装更新"),
            action: #selector(toggleAutomaticUpdates(_:)),
            keyEquivalent: ""
        )
        automaticUpdateItem.target = self
        automaticUpdateItem.state = updateManager.automaticUpdatesEnabled ? .on : .off
        automaticUpdateMenuItem = automaticUpdateItem

        let quitSeparator = NSMenuItem.separator()

        let quitItem = NSMenuItem(
            title: LingGlowL10n.string("关闭灵妆"),
            action: #selector(quitApp(_:)),
            keyEquivalent: "q"
        )
        quitItem.target = self

        statusMenu.removeAllItems()
        statusMenu.addItem(openItem)
        statusMenu.addItem(updateSeparator)
        statusMenu.addItem(checkUpdateItem)
        statusMenu.addItem(automaticUpdateItem)
        statusMenu.addItem(quitSeparator)
        statusMenu.addItem(quitItem)
    }

    @objc
    private func showPopoverFromMenu(_ sender: Any?) {
        showMainWindow()
    }

    @objc
    private func checkForUpdatesFromMenu(_ sender: Any?) {
        checkForUpdates(interactive: true)
    }

    @objc
    private func toggleAutomaticUpdates(_ sender: Any?) {
        updateManager.automaticUpdatesEnabled.toggle()
        automaticUpdateMenuItem?.state = updateManager.automaticUpdatesEnabled ? .on : .off
    }

    private func observeLanguageChanges() {
        languageCancellable = model.$interfaceLanguage
            .dropFirst()
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard let self else { return }
                self.configureMainMenu()
                self.configureStatusMenu()
                self.statusItem?.button?.toolTip = LingGlowL10n.string("灵妆｜AI 助手主题与换肤")
                self.statusItem?.button?.setAccessibilityLabel(LingGlowL10n.string("打开灵妆"))
                self.mainWindow?.title = LingGlowL10n.string("灵妆｜AI 助手主题与换肤")
            }
    }

    private func checkForUpdates(interactive: Bool) {
        guard !checkingForUpdate, !downloadingUpdate else { return }
        checkingForUpdate = true
        checkUpdateMenuItem?.title = LingGlowL10n.string("正在检查更新…")
        Task { [weak self] in
            guard let self else { return }
            defer {
                checkingForUpdate = false
                if !downloadingUpdate {
                    checkUpdateMenuItem?.title = LingGlowL10n.string("检查更新…")
                }
            }
            do {
                guard let update = try await updateManager.availableUpdate() else {
                    if interactive {
                        presentUpdateInformation(
                            title: LingGlowL10n.string("已是最新版本"),
                            message: LingGlowL10n.string("当前版本 %@ 已是最新版本。", updateManager.currentVersion)
                        )
                    }
                    return
                }
                if updateManager.automaticUpdatesEnabled {
                    beginInstalling(update)
                } else {
                    presentUpdatePrompt(update)
                }
            } catch {
                if interactive {
                    presentUpdateInformation(title: LingGlowL10n.string("检查更新失败"), message: error.localizedDescription)
                }
            }
        }
    }

    private func presentUpdatePrompt(_ update: LingGlowUpdateManifest) {
        showMainWindow()
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = LingGlowL10n.string("灵妆 %@ 可以更新", update.version)
        alert.informativeText = update.localizedReleaseNotes
            ?? LingGlowL10n.string("已发布新版本。安装前会校验文件摘要、开发者签名和 Apple 公证票据。")
        alert.addButton(withTitle: LingGlowL10n.string("立即更新"))
        alert.addButton(withTitle: LingGlowL10n.string("稍后"))
        let automatic = NSButton(
            checkboxWithTitle: LingGlowL10n.string("以后自动下载并安装安全更新"),
            target: nil,
            action: nil
        )
        automatic.state = updateManager.automaticUpdatesEnabled ? .on : .off
        alert.accessoryView = automatic
        let response = alert.runModal()
        updateManager.automaticUpdatesEnabled = automatic.state == .on
        automaticUpdateMenuItem?.state = updateManager.automaticUpdatesEnabled ? .on : .off
        if response == .alertFirstButtonReturn {
            beginInstalling(update)
        }
    }

    private func beginInstalling(_ update: LingGlowUpdateManifest) {
        guard !downloadingUpdate else { return }
        downloadingUpdate = true
        checkUpdateMenuItem?.title = LingGlowL10n.string("正在下载更新…")
        Task { [weak self] in
            guard let self else { return }
            do {
                try await updateManager.downloadVerifyAndInstall(update)
            } catch {
                downloadingUpdate = false
                checkUpdateMenuItem?.title = LingGlowL10n.string("检查更新…")
                presentUpdateInformation(title: LingGlowL10n.string("更新被拒绝"), message: error.localizedDescription)
            }
        }
    }

    private func presentUpdateInformation(title: String, message: String) {
        showMainWindow()
        let alert = NSAlert()
        alert.alertStyle = .informational
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: LingGlowL10n.string("好"))
        alert.runModal()
    }

    @objc
    private func quitApp(_ sender: Any?) {
        NSApp.terminate(nil)
    }

    private func showStatusMenu() {
        guard let button = statusItem?.button else { return }
        automaticUpdateMenuItem?.state = updateManager.automaticUpdatesEnabled ? .on : .off
        statusMenu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height), in: button)
    }

    private func showMainWindow() {
        if let mainWindow {
            mainWindow.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            if model.connectionState == .connected {
                Task { await model.refreshAll() }
            }
            return
        }

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 800),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = LingGlowL10n.string("灵妆｜AI 助手主题与换肤")
        window.identifier = NSUserInterfaceItemIdentifier("lingglow.main-window")
        window.contentView = NSHostingView(rootView: StudioRootView(model: model))
        window.minSize = NSSize(width: 900, height: 660)
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = false
        window.backgroundColor = NSColor.windowBackgroundColor
        window.isOpaque = true
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.tabbingMode = .disallowed
        window.collectionBehavior = [.moveToActiveSpace, .fullScreenPrimary]
        if !window.setFrameUsingName("LingGlowMainWindow") {
            window.center()
        }
        window.setFrameAutosaveName("LingGlowMainWindow")
        window.makeKeyAndOrderFront(nil)
        mainWindow = window
        NSApp.activate(ignoringOtherApps: true)
        if model.connectionState == .connected {
            Task { await model.refreshAll() }
        }
    }

    private func observeReminders() {
        // De-duplicate before dropping nils: the `nil` that consumeReminder
        // publishes must reset the duplicate filter, otherwise a reminder that
        // was re-queued (the model was busy when the user decided) is silently
        // suppressed as a duplicate and never presented again.
        reminderCancellable = model.$pendingReminder
            .removeDuplicates()
            .compactMap { $0 }
            .receive(on: RunLoop.main)
            .sink { [weak self] reminder in
                self?.handleReminderWhenReady(reminder)
            }
    }

    private func handleReminderWhenReady(_ reminder: ScheduleReminder) {
        guard !presentingReminder else { return }
        if NSApp.modalWindow != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
                self?.handleReminderWhenReady(reminder)
            }
            return
        }
        presentingReminder = true
        let choice = presentReminder(reminder)
        Task {
            defer { presentingReminder = false }
            switch choice {
            case .snooze:
                _ = await model.consumeReminder(reminder, action: "snooze")
            case .skip:
                _ = await model.consumeReminder(reminder, action: "skip")
            case .apply:
                guard let intent = await model.consumeReminder(reminder, action: "apply") else { return }
                guard presentIntentConfirmation(intent, skinName: reminder.skinName) else { return }
                await model.confirm(intent)
            }
        }
    }
}
