pub const BUTTON_A: u16 = 0x1000;
pub const BUTTON_B: u16 = 0x2000;
const GUIDE: u16 = 0x0400;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PadState {
    pub buttons: u16,
    pub triggers: [u8; 2],
    pub sticks: [i16; 4],
}

impl PadState {
    fn allowed_buttons(self) -> u16 {
        self.buttons & !GUIDE
    }
}

#[cfg(windows)]
pub use bus::{Bus, Pad};

#[cfg(windows)]
mod bus {
    use std::sync::Arc;

    use vigem_client::{Client, Error, TargetId, XButtons, XGamepad, Xbox360Wired};

    use super::PadState;

    pub struct Bus(Arc<Client>);

    impl Bus {
        pub fn connect() -> Result<Option<Self>, String> {
            match Client::connect() {
                Ok(client) => Ok(Some(Self(Arc::new(client)))),
                Err(Error::BusNotFound) => Ok(None),
                Err(e) => Err(format!("ViGEmBus: {e}")),
            }
        }

        pub fn plug(&self) -> Result<Pad, String> {
            let mut target = Xbox360Wired::new(self.0.clone(), TargetId::XBOX360_WIRED);
            target.plugin().map_err(|e| format!("ViGEmBus: {e}"))?;
            target.wait_ready().map_err(|e| format!("ViGEmBus: {e}"))?;
            Ok(Pad(target))
        }
    }

    pub struct Pad(Xbox360Wired<Arc<Client>>);

    impl Pad {
        pub fn set(&mut self, state: PadState) -> Result<(), Error> {
            let [left_trigger, right_trigger] = state.triggers;
            let [thumb_lx, thumb_ly, thumb_rx, thumb_ry] = state.sticks;
            self.0.update(&XGamepad {
                buttons: XButtons(state.allowed_buttons()),
                left_trigger,
                right_trigger,
                thumb_lx,
                thumb_ly,
                thumb_rx,
                thumb_ry,
            })
        }
    }

    impl Drop for Pad {
        fn drop(&mut self) {
            if let Err(e) = self.0.unplug() {
                log::warn!("remove virtual controller: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guide_button_never_reaches_the_host() {
        let state = PadState {
            buttons: u16::MAX,
            ..PadState::default()
        };
        assert_eq!(state.allowed_buttons(), 0xfbff);
        assert_eq!(
            PadState {
                buttons: BUTTON_A | BUTTON_B,
                ..PadState::default()
            }
            .allowed_buttons(),
            0x3000
        );
    }
}
