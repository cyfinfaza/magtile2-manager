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

export function cobsEncode(input) {
	const output = [];
	let blockStart = 0;

	for (let i = 0; i <= input.length; i++) {
		if (i === input.length || input[i] === 0) {
			const blockLength = i - blockStart + 1;
			output.push(blockLength);
			for (let j = blockStart; j < i; j++) {
				output.push(input[j]);
			}
			blockStart = i + 1;
		}
	}

	return new Uint8Array(output);
}
