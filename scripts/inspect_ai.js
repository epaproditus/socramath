const { streamText } = require('ai');
console.log('streamText type:', typeof streamText);

try {
    const result = streamText({
        model: {
            specificationVersion: 'v2',
            provider: 'mock',
            modelId: 'mock-model',
            doStream: async () => ({
                stream: {
                    pipeThrough: () => ({
                        getReader: () => ({
                            read: async () => ({ done: true, value: undefined })
                        })
                    })
                },
                usage: { inputTokens: 0, outputTokens: 0 },
            })
        },
        messages: []
    });
    console.log('Result keys:', Object.keys(result));
    // also check prototype
    let proto = Object.getPrototypeOf(result);
    console.log('Result prototype properties:', Object.getOwnPropertyNames(proto));
} catch (err) {
    console.log('Execution failed:', err.message);
    if (err.message.includes('specification version')) {
        console.log('Changing spec version to v2...');
        // RETRY WITH V2/V3 logic if needed, but error message will tell us
    }
}
