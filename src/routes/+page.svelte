<script>
	import { json } from "@sveltejs/kit";

	let connected = false;
	let deviceName = "";
	let device;
	let reader;

	let data = $state({});

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

	function assignPathValue(str, obj = {}) {
		try {
			const parts = str.trim().split(/\s+/);
			const value = parseFloat(parts.pop());
			const path = parts;

			let current = obj;
			for (let i = 0; i < path.length - 1; i++) {
				if (!(path[i] in current)) {
					current[path[i]] = {};
				}
				current = current[path[i]];
			}
			current[path[path.length - 1]] = value;

			return obj;
		} catch (error) {
			console.error("Error assigning path value:", error);
			return obj;
		}
	}

	async function startReading() {
		let partialLine = ""; // Buffer to store incomplete lines between reads

		try {
			while (device && connected) {
				const result = await device.transferIn(3, 64); // endpoint 3, 64 bytes
				const decoder = new TextDecoder();
				const text = decoder.decode(result.data);

				// Combine with any previous partial line
				const fullText = partialLine + text;
				const lines = fullText.split("\n");

				// The last line might be incomplete unless the text ends with a newline
				partialLine = lines.pop() || "";

				// Process complete lines
				lines.forEach((line) => {
					if (line.trim().length > 0) {
						console.log("[WebUSB] Received:", line.trim());
						assignPathValue(line, data);
						console.log("[WebUSB] Parsed data:", data);
					}
				});

				// If the text ended with a newline, the last element of lines would be
				// an empty string and partialLine would be empty.
				// If the text didn't end with a newline, partialLine now holds the incomplete line.
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
