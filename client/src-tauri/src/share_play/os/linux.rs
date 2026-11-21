use std::collections::HashSet;

use x11rb::connection::Connection;
use x11rb::protocol::Event;
use x11rb::protocol::xinput::{ConnectionExt, Device, EventMask, XIEventMask};
use x11rb::rust_connection::RustConnection;

pub struct HostMouse {
    connection: RustConnection,
    xtest_pointers: HashSet<u16>,
}

impl HostMouse {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let (connection, _) = x11rb::connect(None)?;
        let version = connection.xinput_xi_query_version(2, 1)?.reply()?;
        // XI 2.1 delivers raw events even while another client has a grab.
        if (version.major_version, version.minor_version) < (2, 1) {
            return Err("Share Play needs XInput 2.1".into());
        }
        let masks = [
            EventMask {
                deviceid: Device::ALL_MASTER.into(),
                mask: vec![
                    XIEventMask::RAW_MOTION
                        | XIEventMask::RAW_BUTTON_PRESS
                        | XIEventMask::RAW_BUTTON_RELEASE,
                ],
            },
            EventMask {
                deviceid: Device::ALL.into(),
                mask: vec![XIEventMask::HIERARCHY],
            },
        ];
        for screen in &connection.setup().roots {
            connection
                .xinput_xi_select_events(screen.root, &masks)?
                .check()?;
        }
        let mut mouse = Self {
            connection,
            xtest_pointers: HashSet::new(),
        };
        mouse.refresh_devices()?;
        Ok(mouse)
    }

    fn refresh_devices(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        self.xtest_pointers = self
            .connection
            .xinput_xi_query_device(Device::ALL)?
            .reply()?
            .infos
            .into_iter()
            .filter(|device| device.name.ends_with(b" XTEST pointer"))
            .map(|device| device.deviceid)
            .collect();
        Ok(())
    }

    pub fn active(&mut self) -> Result<bool, Box<dyn std::error::Error>> {
        let mut active = false;
        while let Some(event) = self.connection.poll_for_event()? {
            let source = match event {
                Event::XinputRawMotion(event)
                | Event::XinputRawButtonPress(event)
                | Event::XinputRawButtonRelease(event) => event.sourceid,
                Event::XinputHierarchy(_) => {
                    self.refresh_devices()?;
                    continue;
                }
                _ => continue,
            };
            active |= !self.xtest_pointers.contains(&source);
        }
        Ok(active)
    }
}
