export function cobsDecode(input) {
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
