import SwiftUI

enum ReylumiExecutionEnvironment {
    static var isXCTestHost: Bool {
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        return environment["XCTestConfigurationFilePath"] != nil || environment["XCTestBundlePath"] != nil
            || NSClassFromString("XCTestCase") != nil || NSClassFromString("XCTest.XCTestCase") != nil
        #else
        return false
        #endif
    }
}

@main
struct ReylumiApp: App {
    @UIApplicationDelegateAdaptor(ReylumiAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var marketReturnSequence = 0
    @State private var checkinPath: String?
    @State private var checkinSequence = 0
    @State private var giftCardPath: String?
    @State private var giftCardSequence = 0
    var body: some Scene {
        WindowGroup {
            if ReylumiExecutionEnvironment.isXCTestHost {
                // XCTest constructs its explicit real WK fixtures itself. The
                // host scene must not also boot the production app/analytics.
                Color.white.ignoresSafeArea().accessibilityIdentifier("reylumi.xctest-idle")
            } else {
                ReylumiView(marketReturnSequence: marketReturnSequence, checkinPath: checkinPath, checkinSequence: checkinSequence, giftCardPath: giftCardPath, giftCardSequence: giftCardSequence)
                    .ignoresSafeArea(.container, edges: .bottom)
                    .ignoresSafeArea(.keyboard)
                    .background(Color.white.ignoresSafeArea())
                    .preferredColorScheme(.light)
                    .onOpenURL { url in
                        if NavigationPolicy.isMarketReturn(url) {
                            checkinPath = nil; giftCardPath = nil
                            marketReturnSequence += 1
                        }
                        receiveCheckin(url)
                        receiveGiftCard(url)
                    }
                    .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                        if let url = activity.webpageURL { receiveCheckin(url); receiveGiftCard(url) }
                    }
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background, !ReylumiExecutionEnvironment.isXCTestHost { ReylumiBackgroundSync.shared.schedule() }
        }
    }
    private func receiveCheckin(_ url: URL) {
        guard let path = NavigationPolicy.personalCheckinPath(url) else { return }
        giftCardPath = nil
        checkinPath = path; checkinSequence += 1
    }
    private func receiveGiftCard(_ url: URL) {
        guard let path = NavigationPolicy.giftCardPath(url) else { return }
        checkinPath = nil
        giftCardPath = path; giftCardSequence += 1
    }
}

struct ReylumiView: UIViewControllerRepresentable {
    var marketReturnSequence: Int
    var checkinPath: String? = nil
    var checkinSequence: Int = 0
    var giftCardPath: String? = nil
    var giftCardSequence: Int = 0
    func makeUIViewController(context: Context) -> ReylumiAppContainer {
        let controller = ReylumiAppContainer()
        controller.openPersonalCheckin(path: checkinPath, sequence: checkinSequence)
        controller.openGiftCard(path: giftCardPath, sequence: giftCardSequence)
        return controller
    }
    func updateUIViewController(_ controller: ReylumiAppContainer, context: Context) {
        controller.returnToMarket(sequence: marketReturnSequence)
        controller.openPersonalCheckin(path: checkinPath, sequence: checkinSequence)
        controller.openGiftCard(path: giftCardPath, sequence: giftCardSequence)
    }
}
