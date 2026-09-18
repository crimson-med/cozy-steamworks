use napi_derive::napi;

#[napi]
pub mod screenshots {
    use napi::bindgen_prelude::BigInt;
    use std::ffi::CString;
    use std::path::Path;
    use steamworks::sys;

    /// Add an image file on disk to the user's Steam screenshot library
    /// (ISteamScreenshots::AddScreenshotToLibrary). The path must be absolute.
    /// JPG, PNG or TGA. No thumbnail: pass none and Steam generates one.
    /// The write is asynchronous; ScreenshotReady fires when it completes.
    /// @returns the local screenshot handle, or null if Steam refused the file
    #[napi]
    pub fn add_to_library(path: String, width: i32, height: i32) -> Option<u32> {
        // The crate canonicalizes against the working directory, which would
        // accept a relative path, and unwraps its CString conversion. Reject
        // both cases here so a bad path from the game can never panic.
        let path = Path::new(&path);
        if !path.is_absolute() || path.as_os_str().as_encoded_bytes().contains(&0) {
            return None;
        }

        let client = crate::client::get_client();
        client
            .screenshots()
            .add_screenshot_to_library(path, None, width, height)
            .ok()
    }

    /// Caption a screenshot with a location (ISteamScreenshots::SetLocation),
    /// e.g. "Deep Sea". Call after ScreenshotReady for that handle.
    /// @returns Steam's accepted flag
    #[napi]
    pub fn set_location(handle: u32, location: String) -> bool {
        let Ok(location) = CString::new(location) else {
            return false;
        };

        // Hold the client so the interface pointer below is valid.
        let _client = crate::client::get_client();
        unsafe {
            let screenshots = sys::SteamAPI_SteamScreenshots_v003();
            if screenshots.is_null() {
                return false;
            }
            sys::SteamAPI_ISteamScreenshots_SetLocation(screenshots, handle, location.as_ptr())
        }
    }

    /// Tag a Steam user as appearing in a screenshot (ISteamScreenshots::TagUser).
    /// Call after ScreenshotReady for that handle. May be called several times.
    /// @returns Steam's accepted flag
    #[napi]
    pub fn tag_user(handle: u32, steam_id64: BigInt) -> bool {
        // Hold the client so the interface pointer below is valid.
        let _client = crate::client::get_client();
        unsafe {
            let screenshots = sys::SteamAPI_SteamScreenshots_v003();
            if screenshots.is_null() {
                return false;
            }
            sys::SteamAPI_ISteamScreenshots_TagUser(screenshots, handle, steam_id64.get_u64().1)
        }
    }
}
