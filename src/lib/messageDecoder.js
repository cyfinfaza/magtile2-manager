const bitfieldTypes = {
	MT2_Slave_Status: ["alive", "arm_ready", "arm_active", "coils_nonzero", "shutdown_from_fault"],
	MT2_Slave_Faults: [
		"temp_fault",
		"current_spike_fault",
		"vsense_fault",
		"invalid_value_fault",
		"communication_fault",
		"address_conflict_fault",
		"hv_sag_fault"
	],
	MT2_Global_State: ["global_arm", "global_fault_clear"],
	MT2_Slave_Settings: ["identify", "local_fault_clear"],
	MT2_Master_PowerSwitchStatus: ["hv_relay_on", "precharge_ssr_on", "shdn_12_on", "fault_12", "hv_shutdown_from_fault", "hv_ready"],
	MT2_Master_UsbInterfaceStatus: ["vendor_active", "cdc_active"],
	MT2_Master_PowerSystemFaults: [
		"ov_5v",
		"uv_5v",
		"oc_5v",
		"ov_12v",
		"uv_12v",
		"oc_12v",
		"ov_hv",
		"uv_hv",
		"oc_hv",
		"efuse_12v_fault",
		"master_overtemp",
		"precharge_fault",
		"slave_fault",
		"communication_fault"
	]
};

const tileRegistryMap = {
	0x04: { name: "slave_status", type: "MT2_Slave_Status" },
	0x05: { name: "slave_faults", type: "MT2_Slave_Faults" },
	0x06: { name: "global_state", type: "MT2_Global_State" },
	0x07: { name: "slave_settings", type: "MT2_Slave_Settings" },

	0x08: { name: "v_sense_5", type: "float32" },
	0x09: { name: "v_sense_12", type: "float32" },
	0x0a: { name: "v_sense_hv", type: "float32" },
	0x0b: { name: "master_v_sense_hv", type: "float32" },

	0x0c: { name: "adj_west_addr", type: "uint8" },
	0x0d: { name: "adj_north_addr", type: "uint8" },
	0x0e: { name: "adj_east_addr", type: "uint8" },
	0x0f: { name: "adj_south_addr", type: "uint8" },

	0x10: { name: "coil_1_setpoint", type: "uint16" },
	0x11: { name: "coil_2_setpoint", type: "uint16" },
	0x12: { name: "coil_3_setpoint", type: "uint16" },
	0x13: { name: "coil_4_setpoint", type: "uint16" },
	0x14: { name: "coil_5_setpoint", type: "uint16" },
	0x15: { name: "coil_6_setpoint", type: "uint16" },
	0x16: { name: "coil_7_setpoint", type: "uint16" },
	0x17: { name: "coil_8_setpoint", type: "uint16" },
	0x18: { name: "coil_9_setpoint", type: "uint16" },
	0x20: { name: "coil_1_current_reading", type: "uint16" },
	0x21: { name: "coil_2_current_reading", type: "uint16" },
	0x22: { name: "coil_3_current_reading", type: "uint16" },
	0x23: { name: "coil_4_current_reading", type: "uint16" },
	0x24: { name: "coil_5_current_reading", type: "uint16" },
	0x25: { name: "coil_6_current_reading", type: "uint16" },
	0x26: { name: "coil_7_current_reading", type: "uint16" },
	0x27: { name: "coil_8_current_reading", type: "uint16" },
	0x28: { name: "coil_9_current_reading", type: "uint16" },
	0x30: { name: "coil_1_temp", type: "int16" },
	0x31: { name: "coil_2_temp", type: "int16" },
	0x32: { name: "coil_3_temp", type: "int16" },
	0x33: { name: "coil_4_temp", type: "int16" },
	0x34: { name: "coil_5_temp", type: "int16" },
	0x35: { name: "coil_6_temp", type: "int16" },
	0x36: { name: "coil_7_temp", type: "int16" },
	0x37: { name: "coil_8_temp", type: "int16" },
	0x38: { name: "coil_9_temp", type: "int16" },
	0x40: { name: "coil_1_estimated_resistance", type: "int16" },
	0x41: { name: "coil_2_estimated_resistance", type: "int16" },
	0x42: { name: "coil_3_estimated_resistance", type: "int16" },
	0x43: { name: "coil_4_estimated_resistance", type: "int16" },
	0x44: { name: "coil_5_estimated_resistance", type: "int16" },
	0x45: { name: "coil_6_estimated_resistance", type: "int16" },
	0x46: { name: "coil_7_estimated_resistance", type: "int16" },
	0x47: { name: "coil_8_estimated_resistance", type: "int16" },
	0x48: { name: "coil_9_estimated_resistance", type: "int16" },

	0xc0: { name: "build_number", type: "uint16" },
	0xc1: { name: "mcu_temp", type: "uint16" },
	0xc2: { name: "main_loop_freq", type: "uint32" }
};

const masterRegistryMap = {
	0x10: { name: "power_switch_status", type: "MT2_Master_PowerSwitchStatus" },
	0x11: { name: "power_system_faults", type: "MT2_Master_PowerSystemFaults" },
	0x12: { name: "usb_interface_status", type: "MT2_Master_UsbInterfaceStatus" },
	0x13: { name: "global_state", type: "MT2_Global_State" },

	0x20: { name: "hv_active", type: "uint8" },
	0x21: { name: "clear_faults_requested", type: "uint8" },

	0x30: { name: "mcu_temp", type: "int16" },
	0x31: { name: "v_sense_5", type: "float32" },
	0x32: { name: "v_sense_12_in", type: "float32" },
	0x33: { name: "v_sense_12", type: "float32" },
	0x34: { name: "v_sense_hv_in", type: "float32" },
	0x35: { name: "v_sense_hv", type: "float32" },
	0x36: { name: "i_sense_5", type: "float32" },
	0x37: { name: "i_sense_12", type: "float32" },
	0x38: { name: "i_sense_hv", type: "float32" }
};

export function decodeTileMessage(msg) {
	return decodeMessage(msg, tileRegistryMap);
}

export function decodeMasterMessage(msg) {
	return decodeMessage(msg, masterRegistryMap);
}

function decodeMessage(msg, registryMap) {
	if (!(msg instanceof Uint8Array) || msg.length < 2) return null;

	const regId = msg[0];
	const dataBytes = msg.slice(1);

	const entry = registryMap[regId];
	if (!entry) return { register: regId, error: "Unknown register " + regId };

	let value;
	if (bitfieldTypes[entry.type]) {
		// Decode bitfield types (supporting multi-byte)
		const totalBits = bitfieldTypes[entry.type].length;
		const numBytes = Math.ceil(totalBits / 8);
		if (dataBytes.length < numBytes) {
			return { register: regId, error: `Expected at least ${numBytes} bytes for bitfield` };
		}
		let bitfieldValue = 0;
		for (let i = 0; i < numBytes; i++) {
			bitfieldValue |= dataBytes[i] << (8 * i); // Little endian
		}
		value = {};
		bitfieldTypes[entry.type].forEach((field, index) => {
			value[field] = Boolean((bitfieldValue >> index) & 0x01);
		});
	} else {
		const view = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);
		let getterType = `get${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}`;
		if (typeof view[getterType] === "function") {
			value = view[getterType](0, true);
		} else {
			value = [...dataBytes]; // fallback
		}
	}

	return {
		register: regId,
		name: entry.name,
		value
	};
}
