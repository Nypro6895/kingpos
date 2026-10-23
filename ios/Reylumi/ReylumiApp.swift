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
    var body: some Scene {
        WindowGroup {
            if ReylumiExecutionEnvironment.isXCTestHost {
                // XCTest constructs its explicit real WK fixtures itself. The
                // host scene must not also boot the production app/analytics.
                Color.white.ignoresSafeArea().accessibilityIdentifier("reylumi.xctest-idle")
            } else {
                ReylumiView(marketReturnSequence: marketReturnSequence)
                    .ignoresSafeArea(.keyboard)
                    .background(Color.white.ignoresSafeArea())
                    .preferredColorScheme(.light)
                    .onOpenURL { url in
                        if NavigationPolicy.isMarketReturn(url) { marketReturnSequence += 1 }
                    }
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background, !ReylumiExecutionEnvironment.isXCTestHost { ReylumiBackgroundSync.shared.schedule() }
        }
    }
}

struct ReylumiView: UIViewControllerRepresentable {
    var marketReturnSequence: Int
    func makeUIViewController(context: Context) -> ReylumiAppContainer {
        ReylumiAppContainer()
    }
    func updateUIViewController(_ controller: ReylumiAppContainer, context: Context) {
        controller.returnToMarket(sequence: marketReturnSequence)
    }
}
