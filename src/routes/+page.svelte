<script>
	import { decodeTileMessage, decodeMasterMessage } from "$lib/messageDecoder";
	import { json } from "@sveltejs/kit";
	import { cobsDecode, cobsEncode } from "$lib/cobs";
	import { onMount } from "svelte";

	let connected = $state(false);
	let deviceName = $state("Not connected");
	let device;
	let reader;

	let data = $state({});

	// --- Start WebUSB Reading Loop ---
	async function connectToDevice() {
		try {
			device = await navigator.usb.requestDevice({
				filters: [{ vendorId: 0xc2c2, productId: 0x0f00 }]
			});

			await device.open();
			if (device.configuration === null) {
				await device.selectConfiguration(1);
			}
			await device.claimInterface(2);

			connected = true;
			deviceName = `${device.productName}`;
			startReading();
		} catch (error) {
			console.error("Connection failed:", error);
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
			const cobsEncoded = cobsEncode(message);
			const toSend = new Uint8Array([...cobsEncoded, 0x00]);
			await device.transferOut(3, toSend);
			console.log("Message sent:", toSend);
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
		} else if (
			!masterData.power_switch_status?.hv_relay_on &&
			masterData.power_switch_status?.precharge_ssr_on
		) {
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

	onMount(() => {
		window.sendUSBMessage = sendMessage;
		window.getMasterButtonState = getMasterButtonState;
	});
</script>

<main>
	<div class="masterPanel">
		<h1 class="text-xl font-bold">MagTile2 Manager</h1>
		<button onclick={connectToDevice} disabled={connected}>
			{connected ? "Connected" : "Connect to Device"}
		</button>

		<!-- {#if connected}
			<p class="mt-4 text-green-600">Connected to: {deviceName}</p>
		{:else}
			<p class="mt-4 text-red-600">Not connected</p>
		{/if}
		<p>
			Speed: {(Math.round(speed) / 1000000) * 8} Mb/s
		</p> -->
		<div class="dataBox">
			<h2 style="text-align: center">Master Control</h2>
			<button
				class:accent={connected}
				class={buttonState.class}
				onclick={buttonState.function}
				disabled={!connected}
			>
				{#if connected}
					{buttonState.status} <br />
					{buttonState.action}
				{:else}
					Not Connected
				{/if}
			</button>
		</div>
		<div class="dataBox">
			<h2 style="text-align: center">Power Rails</h2>
			<h3>Input Rails</h3>
			<div>
				<span>12V Input</span>
				<span>{masterData?.v_sense_12_in?.toFixed(2)} V</span>
			</div>
			<div>
				<span>48V Input</span>
				<span>{masterData?.v_sense_hv_in?.toFixed(2)} V</span>
			</div>
			<h3>Output Rails</h3>
			<div>
				<span>5V Output</span>
				<span>{masterData?.v_sense_5?.toFixed(2)} V</span>
			</div>
			<div>
				<span>12V Output</span>
				<span>{masterData?.v_sense_12?.toFixed(2)} V</span>
			</div>
			<div>
				<span>48V Output</span>
				<span>{masterData?.v_sense_hv?.toFixed(2)} V</span>
			</div>
			<h3>Current</h3>
			<div><span>5V Current</span><span>{masterData?.i_sense_5?.toFixed(2)} A</span></div>
			<div><span>12V Current</span><span>{masterData?.i_sense_12?.toFixed(2)} A</span></div>
			<div><span>48V Current</span><span>{masterData?.i_sense_hv?.toFixed(2)} A</span></div>
		</div>

		<div class="dataBox">
			<h2 style="text-align: center">Power Safety System</h2>
			<div>
				<span>48V Domain</span>
				<span class:green-text={masterData?.hv_active}>
					{masterData?.hv_active ? "ON" : "OFF"}
				</span>
			</div>
			<div>
				<span>48V Shutdown Reason</span>
				<span
					class:red-text={masterData?.power_switch_status?.hv_shutdown_from_fault}
					class:green-text={!masterData?.power_switch_status?.hv_shutdown_from_fault}
				>
					{masterData?.power_switch_status?.hv_shutdown_from_fault ? "FAULT" : "NORMAL"}
				</span>
			</div>
			<h3>12V PMIC</h3>
			<div>
				<span>12V PMIC EN</span>
				<span
					class:red-text={masterData?.power_switch_status?.shdn_12_on}
					class:green-text={!masterData?.power_switch_status?.shdn_12_on}
				>
					{!masterData?.power_switch_status?.shdn_12_on ? "ENABLED" : "SHUTDOWN"}
				</span>
			</div>
			<div>
				<span>12V PMIC Fault</span>
				<span
					class:red-text={masterData?.power_switch_status?.fault_12}
					class:green-text={!masterData?.power_switch_status?.fault_12}
				>
					{!masterData?.power_switch_status?.fault_12 ? "OK" : "FAULT"}
				</span>
			</div>
			<h3>48V Switch</h3>
			<div>
				<span>Main 48V Relay</span>
				<span class:green-text={masterData?.power_switch_status?.hv_relay_on}>
					{masterData?.power_switch_status?.hv_relay_on ? "ON" : "OFF"}
				</span>
			</div>
			<div>
				<span>48V Precharge SSR</span>
				<span class:green-text={masterData?.power_switch_status?.precharge_ssr_on}>
					{masterData?.power_switch_status?.precharge_ssr_on ? "ON" : "OFF"}
				</span>
			</div>

			<h3>Safety System Faults</h3>

			<div>
				<span>5V Overvoltage</span>
				<span
					class:red-text={masterData?.power_system_faults?.ov_5v}
					class:green-text={!masterData?.power_system_faults?.ov_5v}
				>
					{masterData?.power_system_faults?.ov_5v ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>5V Undervoltage</span>
				<span
					class:red-text={masterData?.power_system_faults?.uv_5v}
					class:green-text={!masterData?.power_system_faults?.uv_5v}
				>
					{masterData?.power_system_faults?.uv_5v ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>5V Overcurrent</span>
				<span
					class:red-text={masterData?.power_system_faults?.oc_5v}
					class:green-text={!masterData?.power_system_faults?.oc_5v}
				>
					{masterData?.power_system_faults?.oc_5v ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>12V Overvoltage</span>
				<span
					class:red-text={masterData?.power_system_faults?.ov_12v}
					class:green-text={!masterData?.power_system_faults?.ov_12v}
				>
					{masterData?.power_system_faults?.ov_12v ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>12V Undervoltage</span>
				<span
					class:red-text={masterData?.power_system_faults?.uv_12v}
					class:green-text={!masterData?.power_system_faults?.uv_12v}
				>
					{masterData?.power_system_faults?.uv_12v ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>12V Overcurrent</span>
				<span
					class:red-text={masterData?.power_system_faults?.oc_12v}
					class:green-text={!masterData?.power_system_faults?.oc_12v}
				>
					{masterData?.power_system_faults?.oc_12v ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>48V Overvoltage</span>
				<span
					class:red-text={masterData?.power_system_faults?.ov_hv}
					class:green-text={!masterData?.power_system_faults?.ov_hv}
				>
					{masterData?.power_system_faults?.ov_hv ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>48V Undervoltage</span>
				<span
					class:red-text={masterData?.power_system_faults?.uv_hv}
					class:green-text={!masterData?.power_system_faults?.uv_hv}
				>
					{masterData?.power_system_faults?.uv_hv ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>48V Overcurrent</span>
				<span
					class:red-text={masterData?.power_system_faults?.oc_hv}
					class:green-text={!masterData?.power_system_faults?.oc_hv}
				>
					{masterData?.power_system_faults?.oc_hv ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>12V PMIC Fault</span>
				<span
					class:red-text={masterData?.power_system_faults?.efuse_12v_fault}
					class:green-text={!masterData?.power_system_faults?.efuse_12v_fault}
				>
					{masterData?.power_system_faults?.efuse_12v_fault ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>Master Tile Overtemperature</span>
				<span
					class:red-text={masterData?.power_system_faults?.master_overtemp}
					class:green-text={!masterData?.power_system_faults?.master_overtemp}
				>
					{masterData?.power_system_faults?.master_overtemp ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>Precharge Fault</span>
				<span
					class:red-text={masterData?.power_system_faults?.precharge_fault}
					class:green-text={!masterData?.power_system_faults?.precharge_fault}
				>
					{masterData?.power_system_faults?.precharge_fault ? "FAULT" : "OK"}
				</span>
			</div>
			<div>
				<span>Slave Tile Fault</span>
				<span
					class:red-text={masterData?.power_system_faults?.slave_fault}
					class:green-text={!masterData?.power_system_faults?.slave_fault}
				>
					{masterData?.power_system_faults?.slave_fault ? "FAULT" : "OK"}
				</span>
			</div>
		</div>

		<div class="dataBox">
			<h2 style="text-align: center">Master Tile Internals</h2>
			<div>
				<span>MCU Temperature</span>
				<span>{masterData?.mcu_temp} °C</span>
			</div>
			<h3>USB Interface</h3>
			<div>
				<span>WebUSB Config Interface</span>
				<span
					class:red-text={!masterData?.usb_interface_status?.vendor_active}
					class:green-text={masterData?.usb_interface_status?.vendor_active}
				>
					{masterData?.usb_interface_status?.vendor_active ? "ACTIVE" : "INACTIVE"}
				</span>
			</div>
			<div>
				<span>Virtual Serial Port</span>
				<span
					class:red-text={!masterData?.usb_interface_status?.cdc_active}
					class:green-text={masterData?.usb_interface_status?.cdc_active}
				>
					{masterData?.usb_interface_status?.cdc_active ? "ACTIVE" : "INACTIVE"}
				</span>
			</div>
			<h3>Flags</h3>
			<div>
				<span>Clear Faults User Request</span>
				<span>
					{masterData?.clear_faults_requested ? "TRUE" : "FALSE"}
				</span>
			</div>
			<div>
				<span>Global Arm</span>
				<span>
					{masterData?.global_state?.global_arm ? "TRUE" : "FALSE"}
				</span>
			</div>
			<div>
				<span>Global Fault Clear</span>
				<span>
					{masterData?.global_state?.global_fault_clear ? "TRUE" : "FALSE"}
				</span>
			</div>
		</div>
	</div>
	<div class="tileViewer">
		{#each Object.keys(data)
			.filter((key) => key != 0 && data?.[key]?.slave_status?.alive)
			.sort((a, b) => a - b)
			.map((key) => ({ id: key, ...data[key] })) as tile}
			<div class="dataBox">
				<h2 style="text-align: center">Tile ID: {tile.id}</h2>
				<div>
					<span>North</span>
					<span>{tile.adj_north_addr}</span>
				</div>
				<div>
					<span>East</span>
					<span>{tile.adj_east_addr}</span>
				</div>
				<div>
					<span>South</span>
					<span>{tile.adj_south_addr}</span>
				</div>
				<div>
					<span>West</span>
					<span>{tile.adj_west_addr}</span>
				</div>
			</div>
		{/each}
		<details>
			<summary>Full JSON</summary>
			<pre>
				{JSON.stringify(data, null, 2)}
				{#if Object.keys(data).length === 0}
					No data received yet.
				{/if}
			</pre>
		</details>
	</div>
</main>

<style lang="scss">
	main {
		height: 100vh;
		width: 100vw;
		display: flex;
		overflow: hidden;
	}
	.masterPanel {
		width: min(500px, max(25%, 300px));
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
		flex-direction: column;
		padding: var(--spacing);
		gap: var(--spacing);
		overflow: auto;
	}
	.dataBox {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-half);
		background-color: var(--fg);
		border: 1px solid var(--fg);
		padding: var(--spacing);
		border-radius: var(--spacing);
		> div {
			display: flex;
			justify-content: space-between;
			border-bottom: 1px solid var(--fg4);
			> span:nth-child(2) {
				font-weight: bold;
			}
		}
	}
</style>
