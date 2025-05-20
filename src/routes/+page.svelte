<script>
	import { decodeTileMessage } from "$lib/messageDecoder";
	import { json } from "@sveltejs/kit";

	let connected = false;
	let deviceName = "";
	let device;
	let reader;

	let data = $state({});

	// --- Simple COBS Decoder ---
	function cobsDecode(input) {
		const output = [];
		let i = 0;

		while (i < input.length) {
			const code = input[i++];
			if (code === 0 || i + code - 1 > input.length) {
				throw new Error("Malformed COBS input");
			}

			for (let j = 1; j < code; j++) {
				output.push(input[i++]);
			}

			if (code < 0xff && i < input.length) {
				output.push(0);
			}
		}
		return new Uint8Array(output);
	}

	// --- Start WebUSB Reading Loop ---
	async function connectToDevice() {
		try {
			device = await navigator.usb.requestDevice({
				filters: [{ vendorId: 0xcafe }]
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

		const message = decodeTileMessage(decoded.slice(1));

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

	// --- New COBS-aware Reading ---
	async function startReading() {
		let buffer = [];
		let passedFirstDelimiter = false;
		try {
			while (device && connected) {
				const result = await device.transferIn(3, 2048);
				const chunk = new Uint8Array(result.data.buffer);

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
</script>

<main class="p-4">
	<h1 class="text-xl font-bold">WebUSB Terminal</h1>
	<button
		class="mt-2 p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
		on:click={connectToDevice}
		disabled={connected}
	>
		{connected ? "Connected" : "Connect to Device"}
	</button>

	{#if connected}
		<p class="mt-4 text-green-600">Connected to: {deviceName}</p>
	{:else}
		<p class="mt-4 text-red-600">Not connected</p>
	{/if}
	<pre>
		{JSON.stringify(data, null, 2)}
		{#if Object.keys(data).length === 0}
			No data received yet.
		{/if}
	</pre>
</main>
