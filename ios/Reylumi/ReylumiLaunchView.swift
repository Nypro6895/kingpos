import UIKit

/// A bundled R/Lumi wait state, available before WebKit or any network response.
final class ReylumiLaunchView: UIView {
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private let orbit = ReylumiOrbitView()
    private(set) var isLoading = false
    var onRetry: (() -> Void)?
    private var slowLoad: DispatchWorkItem?
    private var vietnamese: Bool { Locale.preferredLanguages.first?.hasPrefix("vi") == true }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        accessibilityIdentifier = "reylumi.launch"
        status.font = .preferredFont(forTextStyle: .subheadline)
        status.textColor = .secondaryLabel
        status.textAlignment = .center
        status.numberOfLines = 0
        status.adjustsFontForContentSizeCategory = true
        retry.configuration = .filled()
        retry.configuration?.baseBackgroundColor = ReylumiOrbitView.teal
        retry.configuration?.cornerStyle = .capsule
        retry.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
        retry.accessibilityIdentifier = "reylumi.launch.retry"
        retry.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        orbit.translatesAutoresizingMaskIntoConstraints = false
        orbit.accessibilityIdentifier = "reylumi.launch.orbit"
        let stack = UIStackView(arrangedSubviews: [orbit, status, retry])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            orbit.widthAnchor.constraint(equalToConstant: 112), orbit.heightAnchor.constraint(equalToConstant: 112),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor), stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
            status.widthAnchor.constraint(lessThanOrEqualTo: widthAnchor, constant: -48)
        ])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func showLoading() {
        slowLoad?.cancel()
        layer.removeAllAnimations()
        alpha = 1; isHidden = false; isLoading = true
        retry.isHidden = true
        status.text = vietnamese ? "Đang tải…" : "Loading…"
        orbit.setLoading(true)
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.isLoading else { return }
            self.status.text = self.vietnamese ? "Kết nối lâu hơn bình thường. Bạn có thể thử lại." : "Taking a little longer. You can try again."
            self.retry.setTitle(self.vietnamese ? "Thử lại" : "Try again", for: .normal)
            self.retry.isHidden = false
        }
        slowLoad = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 8, execute: work)
    }
    func showError() {
        slowLoad?.cancel()
        layer.removeAllAnimations()
        alpha = 1; isHidden = false; isLoading = false
        orbit.setLoading(false)
        status.text = vietnamese ? "Chưa mở được trang. Kiểm tra kết nối rồi thử lại." : "Couldn't open this page. Check your connection and try again."
        retry.setTitle(vietnamese ? "Thử lại" : "Try again", for: .normal)
        retry.isHidden = false
        UIAccessibility.post(notification: .layoutChanged, argument: status)
    }
    func finishLoading() {
        slowLoad?.cancel()
        isLoading = false
        orbit.setLoading(false)
        retry.isHidden = true
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, animations: { self.alpha = 0 }) { [weak self] _ in
            guard let self, !self.isLoading, self.alpha == 0 else { return }
            self.isHidden = true
        }
    }
    @objc private func retryTapped() { onRetry?() }
    deinit { slowLoad?.cancel() }
}
final class ReylumiOrbitView: UIView {
    static let teal = UIColor(red: 29 / 255.0, green: 128 / 255.0, blue: 124 / 255.0, alpha: 1)
    private let orbit = UIView()
    private let logo = UIImageView(image: UIImage(named: "LoadingLogo"))
    private let star = UIImageView(image: UIImage(systemName: "sparkle"))
    private let track = CAShapeLayer()
    private var segments: [CAShapeLayer] = []
    private(set) var isLoading = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = false
        logo.contentMode = .scaleAspectFit
        addSubview(logo)
        track.fillColor = UIColor.clear.cgColor
        track.strokeColor = Self.teal.withAlphaComponent(0.12).cgColor
        layer.addSublayer(track)
        addSubview(orbit)
        // Core Animation rotates a small, reusable trail without a timer.
        for index in 0..<20 {
            let segment = CAShapeLayer()
            segment.strokeColor = Self.teal.withAlphaComponent(CGFloat(index + 1) / 20).cgColor
            segment.fillColor = UIColor.clear.cgColor
            orbit.layer.addSublayer(segment)
            segments.append(segment)
        }
        star.tintColor = Self.teal
        orbit.addSubview(star)
        NotificationCenter.default.addObserver(self, selector: #selector(updateMotion), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(updateMotion), name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(pauseMotion), name: UIApplication.willResignActiveNotification, object: nil)
        setLoading(false)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    deinit { NotificationCenter.default.removeObserver(self) }
    override func didMoveToWindow() { super.didMoveToWindow(); updateMotion() }

    override func layoutSubviews() {
        super.layoutSubviews()
        let side = min(bounds.width, bounds.height)
        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let headSize = min(18, max(8, side * 0.16))
        let lineWidth = max(1, min(2, side / 56))
        // The sparkle's corners stay inside the view at every rotation angle.
        let radius = max(0, side / 2 - headSize / sqrt(2) - lineWidth)
        let logoSize = max(0, side * 0.5)
        logo.frame = CGRect(x: center.x - logoSize / 2, y: center.y - logoSize / 2, width: logoSize, height: logoSize)
        orbit.frame = bounds
        star.frame = CGRect(x: center.x - headSize / 2, y: center.y - radius - headSize / 2, width: headSize, height: headSize)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        track.path = UIBezierPath(arcCenter: center, radius: radius, startAngle: 0, endAngle: .pi * 2, clockwise: true).cgPath
        track.lineWidth = lineWidth / 2
        for (index, segment) in segments.enumerated() {
            let start = -CGFloat.pi / 2 - 1.75 + CGFloat(index) * 1.75 / 20
            segment.path = UIBezierPath(arcCenter: center, radius: radius, startAngle: start, endAngle: start + 0.10, clockwise: true).cgPath
            segment.lineWidth = lineWidth
        }
        CATransaction.commit()
        updateMotion()
    }

    func setLoading(_ value: Bool) {
        isLoading = value
        orbit.isHidden = !value
        track.isHidden = !value
        updateMotion()
    }

    @objc private func pauseMotion() { orbit.layer.removeAnimation(forKey: "reylumi.orbit") }
    @objc private func updateMotion() {
        pauseMotion()
        guard isLoading, window != nil, !UIAccessibility.isReduceMotionEnabled,
              UIApplication.shared.applicationState == .active else { return }
        let animation = CABasicAnimation(keyPath: "transform.rotation.z")
        animation.fromValue = 0
        animation.toValue = CGFloat.pi * 2
        animation.duration = 2.4
        animation.repeatCount = .infinity
        animation.timingFunction = CAMediaTimingFunction(name: .linear)
        orbit.layer.add(animation, forKey: "reylumi.orbit")
    }
}
