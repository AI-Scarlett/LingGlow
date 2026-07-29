import AppKit

enum ReminderChoice {
    case apply
    case snooze
    case skip
}

@MainActor
func presentIntentConfirmation(_ intent: ApplyIntent, skinName: String) -> Bool {
    let restoring = intent.summary.operation == "restore"
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.icon = NSImage(
        systemSymbolName: restoring ? "arrow.uturn.backward.circle.fill" : "paintbrush.pointed.fill",
        accessibilityDescription: nil
    )
    alert.messageText = restoring
        ? LingGlowL10n.string("恢复官方原版并重启？")
        : LingGlowL10n.string("应用「%@」并重启？", LingGlowL10n.string(skinName))

    var details = intent.summary.impact.message.map { LingGlowL10n.string($0) }
        ?? LingGlowL10n.string("%@ 将正常退出并重新打开。", ClientID(rawValue: intent.summary.clientId)?.displayName ?? LingGlowL10n.string("目标应用"))
    details += intent.summary.impact.targetRunning
        ? LingGlowL10n.string("\n\n目标应用当前正在运行，请先保存尚未提交的内容。")
        : LingGlowL10n.string("\n\n目标应用当前未运行，只有确认后才会启动。")
    details += restoring
        ? LingGlowL10n.string("\n恢复后将以无调试参数的官方模式启动。")
        : LingGlowL10n.string("\n皮肤将通过本机安全 Pipe 通道加载。")
    alert.informativeText = details
    alert.addButton(withTitle: LingGlowL10n.string(restoring ? "确认恢复并重启" : "确认应用并重启"))
    alert.addButton(withTitle: LingGlowL10n.string("取消"))
    NSApp.activate(ignoringOtherApps: true)
    return alert.runModal() == .alertFirstButtonReturn
}

/// A permanent one-skin code deliberately has a second, native confirmation
/// after the trusted service has identified its offer type.  The first
/// activation request is intentionally sent without a skin ID; this dialog is
/// therefore never shown for VIP or custom-slot codes, and cannot be used to
/// pre-bind an arbitrary code.
@MainActor
func presentPermanentSkinRedemptionConfirmation(_ skin: RedemptionSkin) -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.icon = NSImage(
        systemSymbolName: "lock.fill",
        accessibilityDescription: nil
    )
    alert.messageText = LingGlowL10n.string("永久绑定「%@」？", LingGlowL10n.string(skin.name))
    alert.informativeText = LingGlowL10n.string("这是一套皮肤的永久授权码。继续后，本机会在加密授权库中绑定为「%@」，不能改换成其他皮肤。停用设备会同时停用 Dodo License 激活实例。", LingGlowL10n.string(skin.name))
    alert.addButton(withTitle: LingGlowL10n.string("永久绑定并继续"))
    alert.addButton(withTitle: LingGlowL10n.string("返回修改"))
    NSApp.activate(ignoringOtherApps: true)
    return alert.runModal() == .alertFirstButtonReturn
}

/// Explicitly move a reviewed design-only draft into the executable profile
/// store. This has no apply/restart side effect: the user must still choose a
/// normal apply action afterwards.
@MainActor
func presentDraftPromotionConfirmation(_ profile: UnionProfile) -> Bool {
    let clientName = ClientID(rawValue: profile.targetClientId)?.displayName ?? LingGlowL10n.string("目标 Agent")
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.icon = NSImage(
        systemSymbolName: "arrow.up.forward.app.fill",
        accessibilityDescription: nil
    )
    alert.messageText = LingGlowL10n.string("提升「%@」为可执行皮肤？", profile.name)
    alert.informativeText = LingGlowL10n.string("这会把「%@」从 %@ 的不可执行设计草稿提升为正式自定义皮肤。此操作不会应用、不会重启，也不会注入 %@；提升后仍需你单独确认应用。", profile.name, clientName, clientName)
    alert.addButton(withTitle: LingGlowL10n.string("确认提升，不应用"))
    alert.addButton(withTitle: LingGlowL10n.string("取消"))
    NSApp.activate(ignoringOtherApps: true)
    return alert.runModal() == .alertFirstButtonReturn
}

@MainActor
func presentReminder(_ reminder: ScheduleReminder) -> ReminderChoice {
    let alert = NSAlert()
    alert.alertStyle = .informational
    alert.icon = NSImage(systemSymbolName: "calendar.badge.clock", accessibilityDescription: nil)
    alert.messageText = LingGlowL10n.string("%@ 今天安排了「%@」", reminder.clientName, LingGlowL10n.string(reminder.skinName))
    alert.informativeText = LingGlowL10n.string("现在切换会进入下一步重启确认。你也可以一小时后再提醒，或今天跳过。")
    alert.addButton(withTitle: LingGlowL10n.string("继续切换"))
    alert.addButton(withTitle: LingGlowL10n.string("一小时后提醒"))
    alert.addButton(withTitle: LingGlowL10n.string("今天跳过"))
    NSApp.activate(ignoringOtherApps: true)
    switch alert.runModal() {
    case .alertFirstButtonReturn: return .apply
    case .alertSecondButtonReturn: return .snooze
    default: return .skip
    }
}

@MainActor
func presentLicenseRemovalConfirmation() -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = LingGlowL10n.string("移除本机授权缓存？")
    alert.informativeText = LingGlowL10n.string("本机将停止使用当前缓存权益；已保存的数据不会删除。此操作不会解除单套皮肤码或自定义位码在服务端的永久绑定。")
    alert.addButton(withTitle: LingGlowL10n.string("移除本机缓存"))
    alert.addButton(withTitle: LingGlowL10n.string("取消"))
    NSApp.activate(ignoringOtherApps: true)
    return alert.runModal() == .alertFirstButtonReturn
}

@MainActor
func presentLicenseDeactivationConfirmation() -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.icon = NSImage(systemSymbolName: "rectangle.badge.xmark", accessibilityDescription: nil)
    alert.messageText = LingGlowL10n.string("停用这台 Mac 的授权？")
    alert.informativeText = LingGlowL10n.string("灵妆会直接调用 Dodo 公共 License API 停用当前设备实例，然后清除本机加密授权库及其钥匙串恢复索引。")
    alert.addButton(withTitle: LingGlowL10n.string("停用此设备"))
    alert.addButton(withTitle: LingGlowL10n.string("取消"))
    NSApp.activate(ignoringOtherApps: true)
    return alert.runModal() == .alertFirstButtonReturn
}
