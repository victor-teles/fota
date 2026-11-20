//! fota on-device updater.
//!
//! Owns the patch lifecycle on the device:
//! check -> download -> verify -> stage -> apply on next cold start -> confirm boot or roll back.
//!
//! The engine fork calls into this crate through a small C ABI (see `ffi`) to ask which
//! snapshot to load. Everything else runs off the startup path.

pub mod state;
pub mod store;

pub mod ffi {
    //! C ABI consumed by the engine fork. Kept tiny on purpose.

    /// ABI version, bumped on any breaking change to the exported functions.
    #[no_mangle]
    pub extern "C" fn fota_abi_version() -> u32 {
        1
    }
}
