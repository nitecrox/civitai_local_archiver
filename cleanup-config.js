async function cleanupConfig() {
    try {
        const response = await fetch('http://localhost:3000/add-to-deleted', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filePaths: ["C:\\Users\\User\\Downloads\\test_dir\\[C] Tsuyu Asui (MHA) [XPHG].safetensors"]
            })
        });
        
        const result = await response.json();
        console.log('Cleanup result:', result);
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
}

cleanupConfig();
