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
    var body: some Scene {
        WindowGroup {
            if ReylumiExecutionEnvironment.isXCTestHost {
                // XCTest constructs its explicit real WK fixtures itself. The
                // host scene must not also boot the production app/analytics.
                Color.white.ignoresSafeArea().accessibilityIdentifier("reylumi.xctest-idle")
            } else {
                ReylumiView(marketReturnSequence: marketReturnSequence, checkinPath: checkinPath, checkinSequence: checkinSequence)
                    .ignoresSafeArea(.keyboard)
                    .background(Color.white.ignoresSafeArea())
                    .preferredColorScheme(.light)
                    .onOpenURL { url in
                        if NavigationPolicy.isMarketReturn(url) { marketReturnSequence += 1 }
                        receiveCheckin(url)
                    }
                    .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                        if let url = activity.webpageURL { receiveCheckin(url) }
                    }
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background, !ReylumiExecutionEnvironment.isXCTestHost { ReylumiBackgroundSync.shared.schedule() }
        }
    }
    private func receiveCheckin(_ url: URL) {
        guard let path = NavigationPolicy.personalCheckinPath(url) else { return }
        checkinPath = path; checkinSequence += 1
    }
}

struct ReylumiView: UIViewControllerRepresentable {
    var marketReturnSequence: Int
    var checkinPath: String? = nil
    var checkinSequence: Int = 0
    func makeUIViewController(context: Context) -> ReylumiAppContainer {
        let controller = ReylumiAppContainer()
        controller.openPersonalCheckin(path: checkinPath, sequence: checkinSequence)
        return controller
    }
    func updateUIViewController(_ controller: ReylumiAppContainer, context: Context) {
        controller.returnToMarket(sequence: marketReturnSequence)
        controller.openPersonalCheckin(path: checkinPath, sequence: checkinSequence)
    }
}
