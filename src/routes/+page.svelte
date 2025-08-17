<script>
	import { decodeTileMessage, decodeMasterMessage } from "$lib/messageDecoder";
	import { fail, json } from "@sveltejs/kit";
	import { cobsDecode, cobsEncode } from "$lib/cobs";
	import { onMount } from "svelte";

	let connected = $state(false);
	let deviceName = $state("Not connected");
	let device;
	let reader;
	let autoConnectActive = $state(true);

	let webUsbAvailable = $state(true);
	let unableToClaimDeviceError = $state(false);

	let data = $state({});

	let selectedTile = $state(null);
	let selectedCoilIndex = $state(null);
	let selectedSetpoint = $state(null);

	// --- Start WebUSB Reading Loop ---
	async function connectToDevice(prompt = true) {
		if (navigator.usb) {
			webUsbAvailable = true;
			try {
				if (prompt) {
					device = await navigator.usb.requestDevice({
						filters: [{ vendorId: 0xc2c2, productId: 0x0f00 }]
					});
				} else {
					const devices = await navigator.usb.getDevices();
					if (devices.length > 0) {
						device = devices[0];
					} else {
						return;
					}
				}

				await device.open();
				if (device.configuration === null) {
					await device.selectConfiguration(1);
				}

				try {
					await device.claimInterface(2);
					unableToClaimDeviceError = false;
				} catch (error) {
					unableToClaimDeviceError = true;
					console.error("Unable to claim interface 2:", error);
					return;
				}

				connected = true;
				deviceName = `${device.productName}`;
				startReading();
				autoConnectActive = true;
			} catch (error) {
				console.error("Connection failed:", error);
			}
		} else {
			webUsbAvailable = false;
			console.error("Attempted to connect but WebUSB is not available.");
		}
	}

	// --- Hierarchical Data Insertion ---
	function assignCOBSMessage(decoded) {
		if (decoded.length < 2) return;

		const addr = decoded[0];

		let message;
		if (addr === 0x00) {
			message = decodeMasterMessage(decoded.slice(1));
		} else {
			message = decodeTileMessage(decoded.slice(1));
		}

		if (message.error) {
			console.error("Message decode error:", message.error);
			return;
		}

		const { register, name, value } = message;

		// we want data[addr][name] = value; but need to check if data[addr] exists
		if (!data[addr]) {
			data[addr] = {};
		}
		data[addr][name] = value;
	}

	let speed = $state(0);
	// --- New COBS-aware Reading ---
	async function startReading() {
		let buffer = [];
		let passedFirstDelimiter = false;
		await device.transferOut(3, new Uint8Array([0x00])); // send 0x00 to clear device buffer
		const startTime = performance.now();
		let totalBytes = 0;
		try {
			while (device && connected) {
				const result = await device.transferIn(3, 4096);
				const chunk = new Uint8Array(result.data.buffer);
				totalBytes += chunk.length;
				speed = totalBytes / ((performance.now() - startTime) / 1000);
				// console.log("Speed:", speed, "bytes/s");

				for (let byte of chunk) {
					if (byte === 0x00) {
						if (!passedFirstDelimiter) {
							passedFirstDelimiter = true;
							continue;
						}
						try {
							const decoded = cobsDecode(Uint8Array.from(buffer));
							assignCOBSMessage(decoded);
							// console.log("[WebUSB] Decoded message:", decoded);
							// console.log("[WebUSB] Parsed data:", data);
						} catch (err) {
							console.error("COBS decode error:", err);
						}
						buffer = [];
					} else {
						buffer.push(byte);
					}
				}
			}
		} catch (error) {
			console.error("Read error:", error);
			connected = false;
		}
	}

	// --- Send a message over USB (COBS encoded) ---
	async function sendMessage(bytes) {
		if (!device || !connected) {
			console.warn("Device not connected.");
			return;
		}

		try {
			const message = new Uint8Array(bytes);
			console.log("Sending message (pre-cobs):", message);
			const cobsEncoded = cobsEncode(message);
			const toSend = new Uint8Array([...cobsEncoded, 0x00]);
			await device.transferOut(3, toSend);
			console.log("Message sent (post-cobs):", toSend);
		} catch (e) {
			console.error("Send failed:", e);
		}
	}

	let masterData = $derived(data[0]);

	function arm() {
		sendMessage([0x00, 0x20, 0x01]);
	}

	function disarm() {
		sendMessage([0x00, 0x20, 0x00]);
	}

	function clear_faults() {
		sendMessage([0x00, 0x21, 0x01]);
	}

	function getMasterButtonState() {
		if (!masterData) return { status: "Unavailable", class: "", function: null };

		if (masterData.power_switch_status?.hv_relay_on) {
			return { status: "Armed", action: "Click to Disarm", class: "blue", function: disarm };
		} else if (!masterData.power_switch_status?.hv_relay_on && masterData.power_switch_status?.precharge_ssr_on) {
			return { status: "Precharging", action: "Click to Disarm", class: "cyan", function: disarm };
		} else if (masterData.power_switch_status?.hv_ready) {
			return { status: "Ready", action: "Click to Arm", class: "green", function: arm };
		} else if (masterData.power_switch_status?.hv_shutdown_from_fault) {
			return {
				status: "Disabled Due to Faults",
				action: "Click to Clear Faults",
				class: "red",
				function: clear_faults
			};
		} else {
			const faults = { ...(masterData.power_system_faults || {}) };

			// Clear non-critical faults
			delete faults.uv_5v;
			delete faults.uv_12v;
			delete faults.efuse_12v_fault;

			const hasCriticalFault = Object.values(faults).some(Boolean);

			if (hasCriticalFault) {
				return {
					status: "Not Ready: Critical Issue",
					action: "Arming Unavailable",
					class: "red",
					function: null
				};
			} else if (masterData.power_system_faults?.uv_5v && masterData.power_system_faults?.uv_12v) {
				return {
					status: "Not Ready: 12V Power Disconnected",
					action: "Arming Unavailable",
					class: "yellow",
					function: null
				};
			} else {
				return {
					status: "Not Ready: Critical Issue",
					action: "Arming Unavailable",
					class: "red",
					function: null
				};
			}
		}
	}

	// make derived state for button state
	const buttonState = $derived.by(getMasterButtonState);

	// only alive tiles
	const aliveTiles = $derived.by(() =>
		Object.keys(data)
			.filter((key) => key != 0 && data?.[key]?.slave_status?.alive)
			.sort((a, b) => a - b)
			.map((key) => ({ id: key, ...data[key] }))
	);

	const tileCoordinates = $derived.by(() => {
		let output = {};
		let minX = Infinity,
			minY = Infinity;
		let maxX = -Infinity,
			maxY = -Infinity;

		if (aliveTiles.length > 0) {
			function dfsPlace(tileId, x, y) {
				const tile = data[tileId];
				if (tileId && !output[tileId] && tile?.slave_status?.alive) {
					output[tileId] = { x, y };
					minX = Math.min(minX, x);
					minY = Math.min(minY, y);
					maxX = Math.max(maxX, x);
					maxY = Math.max(maxY, y);

					dfsPlace(tile.adj_north_addr, x, y - 1);
					dfsPlace(tile.adj_east_addr, x + 1, y);
					dfsPlace(tile.adj_south_addr, x, y + 1);
					dfsPlace(tile.adj_west_addr, x - 1, y);
				}
			}

			dfsPlace(aliveTiles[0].id, 0, 0);

			const shiftX = -minX;
			const shiftY = -minY;

			for (const id in output) {
				output[id].x += shiftX;
				output[id].y += shiftY;
			}

			maxX += shiftX;
			maxY += shiftY;
		}

		// determine which tiles were unable to be placed
		let unableToPlace = [];
		for (const tile of aliveTiles) {
			if (!output[tile.id]) {
				unableToPlace.push(tile.id);
			}
		}

		return {
			byTileId: output,
			width: maxX + 1,
			height: maxY + 1,
			unableToPlace
		};
	});

	const tileCoordinateConflict = $derived.by(() => {
		const coords = Object.values(tileCoordinates.byTileId);
		const seen = new Set();
		for (const coord of coords) {
			// console.log(coord);
			const key = `${coord.x},${coord.y}`;
			if (seen.has(key)) {
				return true;
			}
			seen.add(key);
		}
		return false;
	});

	let { minTemp, maxTemp } = $derived.by(() => {
		let min = Infinity;
		let max = -Infinity;

		for (const tile of aliveTiles) {
			for (let i = 1; i <= 9; i++) {
				const temp = tile["coil_" + i + "_temp"];
				if (temp < min) min = temp;
				if (temp > max) max = temp;
			}
		}
		max = Math.max(max, 35);
		return { minTemp: min, maxTemp: max };
	});

	onMount(() => {
		// console.log a message highlighted in green saying Type (bold)data(bold) to see full data report
		webUsbAvailable = !!navigator.usb;
		console.log(
			"%cCall %cdata()%c to see full data report",
			"color: black; background: #0F4; font-size: 1.2em;",
			"color: black; background: #0F4; font-size: 1.2em; font-weight: bold;",
			"color: black; background: #0F4; font-size: 1.2em;"
		);
		window.sendUSBMessage = sendMessage;
		window.getMasterButtonState = getMasterButtonState;
		window.data = () => $state.snapshot(data);
		window.tileCoordinates = () => $state.snapshot(tileCoordinates);
		window.aliveTiles = () => $state.snapshot(aliveTiles);
		window.buttonState = () => $state.snapshot(buttonState);
		// interval to auto connect without prompt every 1 second, if not connected
		const autoConnectInterval = setInterval(() => {
			if (!connected && autoConnectActive) {
				connectToDevice(false);
			}
		}, 1000);
		// cleanup
		return () => {
			clearInterval(autoConnectInterval);
			if (device && device.opened) {
				device.close();
			}
			connected = false;
			deviceName = "Not connected";
		};
	});
</script>

<svelte:head>
	<title>{connected ? "🟢" : "🔴"} MagTile2 Manager</title>
</svelte:head>

{#snippet generic_entry(name, content, isRed, isGreen)}
	<div>
		<span>{name}</span>
		<span class:red-text={isRed} class:green-text={isGreen}>
			{content ?? "--"}
		</span>
	</div>
{/snippet}

{#snippet fault_entry(name, state)}
	{@render generic_entry(name, state ? "FAULT" : "OK", state, !state)}
{/snippet}

{#snippet meter_entry(name, value, unit)}
	{@render generic_entry(name, `${value ?? "--"} ${unit}`)}
{/snippet}

{#snippet flag_entry(name, state)}
	{@render generic_entry(name, state ? "TRUE" : "FALSE")}
{/snippet}

{#snippet onoff_entry(name, state)}
	{@render generic_entry(name, state ? "ON" : "OFF", false, state)}
{/snippet}

{#snippet greenred_entry(name, state, greenText, redText)}
	{@render generic_entry(name, state ? greenText : redText, !state, state)}
{/snippet}

{#snippet greenwhite_entry(name, state, greenText, whiteText)}
	{@render generic_entry(name, state ? greenText : whiteText, false, state)}
{/snippet}

<main class:notConnected={!connected}>
	<div class="masterPanel">
		<h1>MagTile2 Manager</h1>

		<button
			onclick={() => {
				if (!connected) {
					connectToDevice();
				} else {
					device.close();
					autoConnectActive = false;
				}
			}}
			style="display: flex; align-items: center; justify-content: space-between; gap: 1em;"
		>
			<span style="text-align:start;">
				{#if webUsbAvailable}
					{#if unableToClaimDeviceError}
						Unable to claim WebUSB interface. Another window may be connected.
					{:else}
						<svg
							xmlns:svg="http://www.w3.org/2000/svg"
							xmlns="http://www.w3.org/2000/svg"
							version="1.0"
							viewBox="0 0 475.248 228.092"
							id="Layer_1"
							xml:space="preserve"
							style="height: 1.1ch; fill: var(--text);"
							><defs id="defs1337" />
							<path
								d="M 462.836,114.054 L 412.799,85.158 L 412.799,105.771 L 157.046,105.771 L 206.844,53.159 C 211.082,49.762 216.627,47.379 222.331,47.247 C 245.406,47.247 259.109,47.241 264.153,47.231 C 267.572,56.972 276.756,64.003 287.674,64.003 C 301.486,64.003 312.695,52.795 312.695,38.978 C 312.695,25.155 301.487,13.951 287.674,13.951 C 276.756,13.951 267.572,20.978 264.153,30.711 L 222.821,30.704 C 211.619,30.704 199.881,36.85 192.41,44.055 C 192.614,43.841 192.826,43.613 192.398,44.059 C 192.24,44.237 139.564,99.873 139.564,99.873 C 135.335,103.265 129.793,105.633 124.093,105.769 L 95.161,105.769 C 91.326,86.656 74.448,72.256 54.202,72.256 C 31.119,72.256 12.408,90.967 12.408,114.043 C 12.408,137.126 31.119,155.838 54.202,155.838 C 74.452,155.838 91.33,141.426 95.165,122.297 L 123.59,122.297 C 123.663,122.297 123.736,122.301 123.81,122.297 L 186.681,122.297 C 192.37,122.442 197.905,124.813 202.13,128.209 C 202.13,128.209 254.794,183.841 254.957,184.021 C 255.379,184.468 255.169,184.235 254.961,184.025 C 262.432,191.229 274.175,197.371 285.379,197.371 L 325.211,197.362 L 325.211,214.139 L 375.261,214.139 L 375.261,164.094 L 325.211,164.094 L 325.211,180.849 C 325.211,180.849 314.72,180.83 284.891,180.83 C 279.186,180.699 273.635,178.319 269.399,174.922 L 219.59,122.3 L 412.799,122.3 L 412.799,142.946 L 462.836,114.054 z "
								id="path1334"
							/>
						</svg>
						&nbsp;
						{connected ? "Connected" : "Connect to Master Tile"}
					{/if}
				{:else}
					WebUSB is not available. Ensure you are using the latest version of Chrome or Edge.
				{/if}
			</span>
			<span style="height: 0.5em; width: 0.5em; border-radius: 50%; flex-shrink: 0; background: {connected ? '#0f0' : '#f00'}"></span>
		</button>

		<div class="dataBox">
			<h2>Master Control</h2>
			<button class:accent={connected} class={buttonState.class} onclick={buttonState.function} disabled={!connected}>
				{#if connected}
					{buttonState.status} <br />
					{buttonState.action}
				{:else}
					Not Connected
				{/if}
			</button>
		</div>
		<div class="dataBox">
			<h2>Power Rails</h2>

			<h3>Input Rails</h3>
			{@render meter_entry("12V Input", masterData?.v_sense_12_in?.toFixed(2), "V")}
			{@render meter_entry("48V Input", masterData?.v_sense_hv_in?.toFixed(2), "V")}

			<h3>Output Rails</h3>
			{@render meter_entry("5V Output", masterData?.v_sense_5?.toFixed(2), "V")}
			{@render meter_entry("12V Output", masterData?.v_sense_12?.toFixed(2), "V")}
			{@render meter_entry("48V Output", masterData?.v_sense_hv?.toFixed(2), "V")}

			<h3>Current</h3>
			{@render meter_entry("5V Current", masterData?.i_sense_5?.toFixed(2), "A")}
			{@render meter_entry("12V Current", masterData?.i_sense_12?.toFixed(2), "A")}
			{@render meter_entry("48V Current", masterData?.i_sense_hv?.toFixed(2), "A")}
		</div>

		<div class="dataBox">
			<h2>Power Safety System</h2>
			{@render onoff_entry("48V Domain", masterData?.hv_active)}
			{@render greenred_entry("48V Shutdown Reason", !masterData?.power_switch_status?.hv_shutdown_from_fault, "NORMAL", "FAULT")}

			<h3>12V PMIC</h3>
			{@render greenred_entry("12V PMIC EN", !masterData?.power_switch_status?.shdn_12_on, "ENABLED", "SHUTDOWN")}
			{@render greenred_entry("12V PMIC Fault", !masterData?.power_switch_status?.fault_12, "OK", "FAULT")}

			<h3>48V Switch</h3>
			{@render onoff_entry("Main 48V Relay", masterData?.power_switch_status?.hv_relay_on)}
			{@render onoff_entry("48V Precharge SSR", masterData?.power_switch_status?.precharge_ssr_on)}

			<h3>Safety System Faults</h3>
			{@render fault_entry("5V Undervoltage", masterData?.power_system_faults?.uv_5v)}
			{@render fault_entry("5V Overcurrent", masterData?.power_system_faults?.oc_5v)}
			{@render fault_entry("12V Overvoltage", masterData?.power_system_faults?.ov_12v)}
			{@render fault_entry("12V Undervoltage", masterData?.power_system_faults?.uv_12v)}
			{@render fault_entry("12V Overcurrent", masterData?.power_system_faults?.oc_12v)}
			{@render fault_entry("48V Overvoltage", masterData?.power_system_faults?.ov_hv)}
			{@render fault_entry("48V Undervoltage", masterData?.power_system_faults?.uv_hv)}
			{@render fault_entry("48V Overcurrent", masterData?.power_system_faults?.oc_hv)}
			{@render fault_entry("12V PMIC Fault", masterData?.power_system_faults?.efuse_12v_fault)}
			{@render fault_entry("Master Tile Overtemperature", masterData?.power_system_faults?.master_overtemp)}
			{@render fault_entry("Precharge Fault", masterData?.power_system_faults?.precharge_fault)}
			{@render fault_entry("Communication Timeout", masterData?.power_system_faults?.communication_fault)}
			{@render fault_entry("Slave Tile Fault", masterData?.power_system_faults?.slave_fault)}
		</div>

		<div class="dataBox">
			<h2>Master Tile Internals</h2>
			{@render meter_entry("MCU Temperature", masterData?.mcu_temp, "°C")}
			<h3>USB Interface</h3>
			{@render greenred_entry("WebUSB Config Interface", masterData?.usb_interface_status?.vendor_active, "ACTIVE", "INACTIVE")}
			{@render greenred_entry("Virtual Serial Port", masterData?.usb_interface_status?.cdc_active, "ACTIVE", "INACTIVE")}
			<h3>Flags</h3>
			{@render flag_entry("Clear Faults User Request", masterData?.clear_faults_requested)}
			{@render flag_entry("Global Arm", masterData?.global_state?.global_arm)}
			{@render flag_entry("Global Fault Clear", masterData?.global_state?.global_fault_clear)}
		</div>
	</div>
	<div
		class="tileViewer"
		class:noTiles={!aliveTiles || aliveTiles.length === 0}
		style:--tiles-width={tileCoordinates.width}
		style:--tiles-height={tileCoordinates.height}
	>
		{#if tileCoordinates.unableToPlace.length > 0}
			<p>❓ Unable to locate tile</p>
		{/if}
		{#if tileCoordinateConflict}
			<p>⚠️ Tile placement conflict detected</p>
		{/if}
		<div class="tileGrid">
			{#if !aliveTiles || aliveTiles.length === 0}
				<p>No MagTiles detected</p>
			{/if}
			{#each aliveTiles as tile}
				<div
					class="tile"
					style:grid-column={tileCoordinates.byTileId?.[tile.id]?.x + 1 || undefined}
					style:grid-row={tileCoordinates.byTileId?.[tile.id]?.y + 1 || undefined}
					style:background={tile?.slave_status?.arm_ready ? undefined : "#F00"}
					onclick={() => {
						selectedTile = tile;
						console.log("Selected tile:", selectedTile);
					}}
					class:selected={selectedTile?.id === tile.id}
				>
					<!-- <h2>Tile ID: {tile.id}</h2> -->
					<!-- 9 coil divs, show temp, current_reading, and setpoint (rounded to 2 decimal places) -->
					{#each Array(9) as _, i}
						<div
							class="coil"
							style:--temp-level={(tile["coil_" + (i + 1) + "_temp"] - minTemp) / (maxTemp - minTemp)}
							onclick={() => {
								selectedCoilIndex = i + 1;
							}}
							class:selected={selectedCoilIndex === i + 1 && selectedTile?.id === tile.id}
						>
							{Math.round(tile["coil_" + (i + 1) + "_temp"] / 100)} °C <br />
							Set {(tile["coil_" + (i + 1) + "_setpoint"] / 1000)?.toFixed(2)} A <br />
							{(tile["coil_" + (i + 1) + "_current_reading"] / 1000)?.toFixed(2)} A
						</div>
					{/each}
					<div class="tileIdLabel">
						{tile.id}
					</div>
					<div class="tileWarningIcon">
						{#if tileCoordinates.unableToPlace.includes(tile.id)}
							❓
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
	<div class="tilePanel">
		<h2>Tile Data</h2>
		{#if selectedTile}
			<div style="display: flex; flex-direction: column; gap: var(--spacing);">
				<!-- labelled inputs for coil index, tile id, and setpoint, then button to send -->
				<p>
					Tile: <input type="number" disabled bind:value={selectedTile.id} min="1" max="255" style="width: 3em; box-sizing: content-box;" />
					&nbsp; Coil:
					<input type="number" bind:value={selectedCoilIndex} min="1" max="9" style="width: 3em; box-sizing: content-box;" />
				</p>
				<p>
					Setpoint: <input
						type="number"
						min="0"
						max="4.5"
						step="0.1"
						style="width: 4em; box-sizing: content-box;"
						bind:value={selectedSetpoint}
					/> A (≤4.5)
				</p>
				<p>
					<button
						onclick={() => {
							if (selectedTile && selectedCoilIndex && selectedSetpoint) {
								const tileId = selectedTile.id;
								const coilIndex = selectedCoilIndex - 1; // 0-indexed
								const setpoint = Math.round(selectedSetpoint * 1000); // convert to mA
								console.log("Sending setpoint:", tileId, coilIndex, setpoint);
								// send message to tile
								sendMessage([0x00, 0x80, tileId, coilIndex, setpoint & 0xff, (setpoint >> 8) & 0xff]);
							}
						}}
					>
						Set Setpoint
					</button>
					<!-- off button -->
					<button
						onclick={() => {
							if (selectedTile && selectedCoilIndex) {
								const tileId = selectedTile.id;
								const coilIndex = selectedCoilIndex - 1; // 0-indexed
								console.log("Turning off coil:", tileId, coilIndex);
								sendMessage([0x00, 0x80, tileId, coilIndex, 0, 0]);
							}
						}}
					>
						Turn Off Coil
					</button>
				</p>
			</div>
			{#key data[selectedTile.id]}
				<!-- <pre>{selectedTile && JSON.stringify(selectedTile, null, 2)}</pre> -->
				<div class="dataBox">
					<h2>Tile Status</h2>
					{@render greenred_entry("Alive", data[selectedTile.id]?.slave_status?.alive, "YES", "NO")}
					{@render greenred_entry("Ready to Arm", data[selectedTile.id]?.slave_status?.arm_ready, "YES", "NO")}
					{@render greenwhite_entry("Armed", data[selectedTile.id]?.slave_status?.arm_active, "YES", "NO")}
					{@render greenwhite_entry("Coil(s) Active", data[selectedTile.id]?.slave_status?.coils_nonzero, "YES", "NO")}
					{@render greenred_entry("Shutdown Reason", !data[selectedTile.id]?.slave_status?.shutdown_from_fault, "NORMAL", "FAULT")}
				</div>
				<div class="dataBox">
					<h2>Tile Faults</h2>
					{@render fault_entry("Overtemperature", data[selectedTile.id]?.slave_faults?.temp_fault)}
					{@render fault_entry("Current Spike", data[selectedTile.id]?.slave_faults?.current_spike_fault)}
					{@render fault_entry("Invalid Input Voltage Rail", data[selectedTile.id]?.slave_faults?.vsense_fault)}
					{@render fault_entry("Invalid Setpoint Received", data[selectedTile.id]?.slave_faults?.invalid_value_fault)}
					{@render fault_entry("Address Conflict Detected", data[selectedTile.id]?.slave_faults?.address_conflict)}
					{@render fault_entry("Communication Failure", data[selectedTile.id]?.slave_faults?.communication_fault)}
				</div>
				<div class="dataBox">
					<h2>Power Monitoring</h2>
					{@render meter_entry("5V Input", data[selectedTile.id]?.v_sense_5?.toFixed(2), "V")}
					{@render meter_entry("12V Input", data[selectedTile.id]?.v_sense_12?.toFixed(2), "V")}
					{@render meter_entry("48V Input", data[selectedTile.id]?.v_sense_hv?.toFixed(2), "V")}
					{@render meter_entry("MCU Temperature", data[selectedTile.id]?.mcu_temp, "°C")}
				</div>
				<div class="dataBox">
					<h2>Settings & Flags</h2>
					{@render flag_entry("Identify Request", data[selectedTile.id]?.slave_settings?.identify)}
					{@render flag_entry("Local Fault Clear", data[selectedTile.id]?.slave_settings?.local_fault_clear)}
					{@render flag_entry("Global Arm", data[selectedTile.id]?.global_state?.global_arm)}
					{@render flag_entry("Global Fault Clear", data[selectedTile.id]?.global_state?.global_fault_clear)}
				</div>
				<div class="dataBox">
					<h2>Adjacency</h2>
					{@render meter_entry("North", data[selectedTile.id]?.adj_north_addr, "")}
					{@render meter_entry("East", data[selectedTile.id]?.adj_east_addr, "")}
					{@render meter_entry("South", data[selectedTile.id]?.adj_south_addr, "")}
					{@render meter_entry("West", data[selectedTile.id]?.adj_west_addr, "")}
				</div>
			{/key}
		{/if}
	</div>
</main>

<style lang="scss">
	main {
		height: 100vh;
		width: 100vw;
		display: flex;
		overflow: hidden;
		--not-connected-opacity: 0.5;
	}
	.masterPanel {
		width: min(400px, max(25%, 300px));
		background: var(--fg);
		border-right: 2px solid var(--fg);
		padding: var(--spacing);
		display: flex;
		flex-direction: column;
		gap: var(--spacing);
		overflow: auto;
	}
	.tileViewer {
		flex: 1;
		display: flex;
		align-items: flex-start;
		justify-content: flex-start;
		flex-direction: column;
		gap: var(--spacing);
		padding: var(--spacing);
		overflow: auto;
		.notConnected & {
			opacity: var(--not-connected-opacity);
		}
		&.noTiles {
			align-items: center;
			justify-content: center;
		}
	}
	.tilePanel {
		width: min(400px, max(25%, 300px));
		background: var(--fg);
		border-left: 2px solid var(--fg);
		padding: var(--spacing);
		display: flex;
		flex-direction: column;
		gap: var(--spacing);
		overflow: auto;
		.notConnected & {
			opacity: var(--not-connected-opacity);
		}
	}
	.tileGrid {
		display: grid;
		// width: 100%;
		// height: 100%;
		--tile-size: 200px;
		// max-width: calc(var(--tile-size) * var(--tiles-width));
		// max-height: calc(var(--tile-size) * var(--tiles-height));
		grid-template-columns: repeat(var(--coils-width), auto);
		grid-template-rows: repeat(var(--coils-height), auto);
		// overflow: hidden;
		gap: 1px;
	}
	.tile {
		aspect-ratio: 1;
		width: var(--tile-size);
		// max-width: var(--tile-size);
		background: var(--fg);
		border: 2px solid var(--fg2);
		border-radius: var(--spacing);
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(3, 1fr);
		gap: 4%;
		padding: 2%;
		position: relative;
		cursor: pointer;
		&.selected {
			border-color: var(--text);
		}
		> .coil {
			background: var(--fg);
			background: hsl(calc(var(--temp-level) * 120 + 240), 100%, 30%);
			border-radius: 50%;
			display: flex;
			justify-content: center;
			align-items: center;
			transition: background-color 0.5s;
			font-size: 0.7em;
			text-align: center;
			line-height: 1em;
			&.selected {
				border: 2px solid var(--text);
			}
		}
		.tileIdLabel {
			position: absolute;
			top: 66.7%;
			left: 66.7%;
			font-weight: bold;
			transform: translate(-50%, -50%);
			text-shadow: 0 0 4px #000;
		}
		.tileWarningIcon {
			position: absolute;
			top: 66.7%;
			left: 33.3%;
			font-weight: bold;
			transform: translate(-50%, -50%);
			text-shadow: 0 0 4px #000;
		}
	}
	.dataBox {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-half);
		background-color: var(--fg);
		border: 1px solid var(--fg);
		padding: var(--spacing);
		border-radius: var(--spacing);
		> h2 {
			text-align: center;
		}
		> div {
			display: flex;
			justify-content: space-between;
			border-bottom: 1px solid var(--fg4);
			> span:nth-child(2) {
				font-weight: bold;
			}
		}
		.notConnected & {
			opacity: var(--not-connected-opacity);
		}
	}
</style>
