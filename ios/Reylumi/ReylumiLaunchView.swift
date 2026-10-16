import UIKit

/// Bundled UI is available before the first network response or web stylesheet.
final class ReylumiLaunchView: UIView, UITextFieldDelegate {
    private let heading = UILabel()
    private let detail = UILabel()
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private let search = UISearchTextField()
    private let orbit = ReylumiOrbitView()
    private(set) var isLoading = false
    var onRetry: (() -> Void)?
    var onNavigate: ((String, [URLQueryItem]) -> Void)?
    var onEditingFinished: (() -> Void)?
    private var revealDeferred = false
    private var slowLoad: DispatchWorkItem?
    private var vietnamese: Bool { Locale.preferredLanguages.first?.hasPrefix("vi") == true }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .white
        accessibilityIdentifier = "reylumi.launch"
        heading.font = .preferredFont(forTextStyle: .title1)
        heading.textColor = UIColor(red: 0.16, green: 0.14, blue: 0.15, alpha: 1)
        detail.font = .preferredFont(forTextStyle: .subheadline)
        status.font = .preferredFont(forTextStyle: .footnote)
        for label in [heading, detail, status] {
            label.textAlignment = .left
            label.numberOfLines = 0
            label.adjustsFontForContentSizeCategory = true
        }
        detail.textColor = .secondaryLabel
        status.textColor = .secondaryLabel
        retry.configuration = .filled()
        retry.configuration?.baseBackgroundColor = ReylumiOrbitView.teal
        retry.configuration?.cornerStyle = .capsule
        retry.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 24, bottom: 12, trailing: 24)
        retry.addTarget(self, action: #selector(retryTapped), for: .touchUpInside)
        orbit.translatesAutoresizingMaskIntoConstraints = false
        orbit.accessibilityIdentifier = "reylumi.launch.orbit"
        NSLayoutConstraint.activate([orbit.widthAnchor.constraint(equalToConstant: 64), orbit.heightAnchor.constraint(equalToConstant: 64)])
        let brand = UILabel()
        brand.text = "Reylumi"
        brand.font = .systemFont(ofSize: 28, weight: .bold)
        brand.textColor = ReylumiOrbitView.teal
        let header = UIStackView(arrangedSubviews: [orbit, brand, UIView()])
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 10

        search.placeholder = vietnamese ? "Dịch vụ, thành phố hoặc ZIP" : "Services, city or ZIP"
        search.font = .systemFont(ofSize: 17)
        search.returnKeyType = .search
        search.clearButtonMode = .whileEditing
        search.delegate = self
        search.accessibilityIdentifier = "reylumi.launch.search"
        search.heightAnchor.constraint(equalToConstant: 48).isActive = true
        let searchButton = destinationButton(vietnamese ? "Tìm" : "Search", icon: "magnifyingglass", identifier: "reylumi.launch.submit") { [weak self] in self?.submitSearch() }
        let searchRow = UIStackView(arrangedSubviews: [search, searchButton])
        searchRow.axis = .horizontal
        searchRow.spacing = 8

        heading.text = vietnamese ? "Một chút cảm hứng cho hôm nay." : "A little inspiration for your day."
        detail.text = vietnamese ? "Khám phá dịch vụ làm đẹp và nơi bạn yêu thích." : "Discover beauty services and places you'll love."
        let categories = UIStackView()
        categories.axis = .horizontal
        categories.spacing = 8
        categories.distribution = .fillEqually
        for (title, query, icon) in [(vietnamese ? "Móng" : "Nails", "Nails", "sparkles"), (vietnamese ? "Tóc" : "Hair", "Hair", "scissors"), ("Spa", "Spa", "leaf")] {
            categories.addArrangedSubview(destinationButton(title, icon: icon) { [weak self] in
                self?.onNavigate?("/explore", [URLQueryItem(name: "q", value: query)])
            })
        }
        let inspiration = UIView()
        inspiration.backgroundColor = ReylumiOrbitView.teal.withAlphaComponent(0.07)
        inspiration.layer.cornerRadius = 24
        let invitation = UILabel()
        invitation.text = vietnamese ? "Tìm ý tưởng cho lần chăm sóc tiếp theo" : "Find your next beauty idea"
        invitation.font = .preferredFont(forTextStyle: .title2)
        invitation.numberOfLines = 0
        invitation.textColor = ReylumiOrbitView.teal
        let symbols = UIStackView()
        symbols.axis = .horizontal
        symbols.distribution = .fillEqually
        symbols.spacing = 12
        for name in ["sparkles", "paintbrush.pointed", "leaf"] {
            let symbol = UIImageView(image: UIImage(systemName: name))
            symbol.contentMode = .scaleAspectFit
            symbol.tintColor = ReylumiOrbitView.teal.withAlphaComponent(0.7)
            symbol.heightAnchor.constraint(equalToConstant: 64).isActive = true
            symbols.addArrangedSubview(symbol)
        }
        let preview = UIStackView(arrangedSubviews: [symbols, invitation])
        preview.axis = .vertical
        preview.spacing = 20
        preview.translatesAutoresizingMaskIntoConstraints = false
        inspiration.addSubview(preview)
        NSLayoutConstraint.activate([
            preview.leadingAnchor.constraint(equalTo: inspiration.leadingAnchor, constant: 20),
            preview.trailingAnchor.constraint(equalTo: inspiration.trailingAnchor, constant: -20),
            preview.topAnchor.constraint(equalTo: inspiration.topAnchor, constant: 24),
            preview.bottomAnchor.constraint(equalTo: inspiration.bottomAnchor, constant: -24)
        ])
        let navigation = UIStackView(arrangedSubviews: [
            destinationButton(vietnamese ? "Khám phá" : "Explore", icon: "safari", identifier: "reylumi.launch.explore") { [weak self] in self?.onNavigate?("/explore", []) },
            destinationButton(vietnamese ? "Cửa hàng" : "Market", icon: "bag", identifier: "reylumi.launch.market") { [weak self] in self?.onNavigate?("/market", []) }
        ])
        navigation.axis = .horizontal
        navigation.spacing = 12
        navigation.distribution = .fillEqually
        navigation.accessibilityIdentifier = "reylumi.launch.navigation"
        activity.hidesWhenStopped = true
        activity.color = ReylumiOrbitView.teal
        let connection = UIStackView(arrangedSubviews: [status, retry])
        connection.axis = .horizontal
        connection.alignment = .center
        connection.spacing = 10
        status.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let stack = UIStackView(arrangedSubviews: [header, searchRow, heading, detail, categories, inspiration, navigation, connection])
        stack.axis = .vertical
        stack.alignment = .fill
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.keyboardDismissMode = .onDrag
        addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: topAnchor), scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor), scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func showLoading() {
        slowLoad?.cancel()
        layer.removeAllAnimations()
        alpha = 1
        isHidden = false
        isLoading = true
        revealDeferred = false
        retry.isHidden = true
        status.text = vietnamese ? "Đang mở trang…" : "Opening your page…"
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
        alpha = 1
        isHidden = false
        isLoading = false
        revealDeferred = false
        orbit.setLoading(false)
        status.text = vietnamese ? "Chưa mở được trang. Bạn có thể thử lại hoặc chọn Khám phá." : "Couldn't open this page. Try again or choose Explore."
        retry.setTitle(vietnamese ? "Thử lại" : "Try again", for: .normal)
        retry.isHidden = false
        UIAccessibility.post(notification: .layoutChanged, argument: status)
    }

    func finishLoading() {
        slowLoad?.cancel()
        isLoading = false
        orbit.setLoading(false)
        status.text = nil
        retry.isHidden = true
        // Network readiness must not replace a search the user is actively typing.
        if search.isFirstResponder { revealDeferred = true; return }
        revealDeferred = false
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, animations: { self.alpha = 0 }) { [weak self] _ in
            // A new navigation may have started during the fade.
            guard let self, !self.isLoading, !self.revealDeferred, self.alpha == 0 else { return }
            self.isHidden = true
        }
    }

    @objc private func retryTapped() { onRetry?() }

    private func destinationButton(_ title: String, icon: String, identifier: String? = nil, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.tinted()
        configuration.title = title
        configuration.image = UIImage(systemName: icon)
        configuration.imagePadding = 6
        configuration.baseForegroundColor = ReylumiOrbitView.teal
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
        button.configuration = configuration
        button.accessibilityIdentifier = identifier
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func submitSearch() {
        search.resignFirstResponder()
        let query = String((search.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(160))
        onNavigate?("/explore", query.isEmpty ? [] : [URLQueryItem(name: "q", value: query)])
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool { submitSearch(); return true }

    func textFieldDidBeginEditing(_ textField: UITextField) {
        if !isLoading && !isHidden {
            layer.removeAllAnimations()
            alpha = 1
            revealDeferred = true
        }
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        if revealDeferred { onEditingFinished?() }
    }

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
