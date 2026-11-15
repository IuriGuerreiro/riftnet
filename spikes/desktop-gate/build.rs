// libwebrtc's Linux screen capture uses GLib/GIO (D-Bus for the Wayland
// screen-share portal), but webrtc-sys only uses their headers. Link them here.
fn main() {
    for lib in ["gio-2.0", "gobject-2.0", "glib-2.0"] {
        println!("cargo:rustc-link-lib=dylib={lib}");
    }
}
