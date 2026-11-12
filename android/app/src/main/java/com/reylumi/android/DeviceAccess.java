package com.reylumi.android;

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.lifecycle.Lifecycle;

/** Runtime access for the trusted site only. No microphone or background location. */
final class DeviceAccess {
    private final ComponentActivity activity;
    private final WebView web;
    private PermissionRequest cameraRequest;
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
    private java.util.function.Consumer<Boolean> photoCallback;
    private final ActivityResultLauncher<String> camera;
    private final ActivityResultLauncher<String[]> location;

    DeviceAccess(ComponentActivity activity, WebView web) {
        this.activity = activity;
        this.web = web;
        camera = activity.registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
            if (photoCallback != null) {
                java.util.function.Consumer<Boolean> callback = photoCallback;
                photoCallback = null;
                boolean allowed = granted && foregroundTrusted();
                callback.accept(allowed);
                if (!allowed) denied(R.string.camera_denied);
                return;
            }
            PermissionRequest request = cameraRequest;
            cameraRequest = null;
            if (request == null) return;
            if (granted && foregroundTrusted()) request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else { request.deny(); denied(R.string.camera_denied); }
        });
        location = activity.registerForActivityResult(new ActivityResultContracts.RequestMultiplePermissions(), result -> {
            GeolocationPermissions.Callback callback = locationCallback;
            String origin = locationOrigin;
            locationCallback = null; locationOrigin = null;
            if (callback == null) return;
            boolean granted = (Boolean.TRUE.equals(result.get(Manifest.permission.ACCESS_COARSE_LOCATION))
                || Boolean.TRUE.equals(result.get(Manifest.permission.ACCESS_FINE_LOCATION))) && foregroundTrusted();
            callback.invoke(origin, granted, false);
            if (!granted) denied(R.string.location_denied);
        });
    }

    static boolean trustedOrigin(Uri origin) {
        return origin != null && NavigationPolicy.trustedOrigin(origin.toString());
    }
    private boolean foregroundTrusted() {
        return !activity.isFinishing() && !activity.isDestroyed()
            && activity.getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.STARTED)
            && NavigationPolicy.decide(web.getUrl()) == NavigationPolicy.Decision.INTERNAL;
    }
    void camera(PermissionRequest request) {
        String[] resources = request.getResources();
        if (!trustedOrigin(request.getOrigin()) || !foregroundTrusted() || resources.length != 1
            || !PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resources[0])
            || cameraRequest != null || locationCallback != null || photoCallback != null) { request.deny(); return; }
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            cameraRequest = request;
            web.evaluateJavascript("Boolean(navigator.userActivation && navigator.userActivation.isActive)", active -> {
                if (cameraRequest != request) return;
                if ("true".equals(active) && foregroundTrusted()) camera.launch(Manifest.permission.CAMERA);
                else { cameraRequest = null; request.deny(); }
            });
        }
    }
    void cameraCancelled(PermissionRequest request) { if (cameraRequest == request) cameraRequest = null; }
    void photo(java.util.function.Consumer<Boolean> callback) {
        if (!foregroundTrusted() || cameraRequest != null || locationCallback != null || photoCallback != null) {
            callback.accept(false); return;
        }
        if (activity.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) callback.accept(true);
        else { photoCallback = callback; camera.launch(Manifest.permission.CAMERA); }
    }
    void location(String origin, GeolocationPermissions.Callback callback) {
        if (!trustedOrigin(Uri.parse(origin)) || !foregroundTrusted() || cameraRequest != null || locationCallback != null || photoCallback != null) {
            callback.invoke(origin, false, false); return;
        }
        if (activity.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || activity.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            callback.invoke(origin, true, false);
        } else {
            locationCallback = callback; locationOrigin = origin;
            web.evaluateJavascript("Boolean(navigator.userActivation && navigator.userActivation.isActive)", active -> {
                if (locationCallback != callback) return;
                if ("true".equals(active) && foregroundTrusted())
                    location.launch(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION});
                else { locationCancelled(); callback.invoke(origin, false, false); }
            });
        }
    }
    void locationCancelled() { locationCallback = null; locationOrigin = null; }
    void cancelPending() {
        if (photoCallback != null) {
            java.util.function.Consumer<Boolean> callback = photoCallback; photoCallback = null; callback.accept(false);
        }
        if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
        if (locationCallback != null) {
            locationCallback.invoke(locationOrigin, false, false);
            locationCancelled();
        }
    }
    private void denied(int message) {
        if (!activity.isDestroyed()) Toast.makeText(activity, message, Toast.LENGTH_LONG).show();
    }
}
