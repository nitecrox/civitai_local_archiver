import os
import sys
import hashlib
import requests
import json

# Config
BASE_URL = "https://civitai.com/api/v1"
EXTENSION = ".safetensors"

def get_sha256(file_path):
    """Compute the SHA-256 hash of a file."""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def fetch_model_version_by_hash(file_hash):
    """Query Civitai for a model version using the file hash."""
    url = f"{BASE_URL}/model-versions/by-hash/{file_hash}"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"[ERROR] Failed to fetch model version for hash {file_hash} - {response.status_code}")
        return None

def fetch_model_details(model_id):
    """Query Civitai for model details using the model ID."""
    url = f"{BASE_URL}/models/{model_id}"
    response = requests.get(url)
    if response.status_code == 200:
        return response.json()
    else:
        print(f"[ERROR] Failed to fetch model for ID {model_id} - {response.status_code}")
        return None

def save_model_info(file_path, data):
    """Save JSON data next to the original file."""
    json_path = os.path.splitext(file_path)[0] + ".json"
    try:
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        print(f"[INFO] Saved model info to {json_path}")
    except Exception as e:
        print(f"[ERROR] Failed to save JSON for {file_path} - {e}")

# def main(search_dir):
#     for root, dirs, files in os.walk(search_dir):
#         for file in files:
#             if file.endswith(EXTENSION):
#                 file_path = os.path.join(root, file)
#                 print(f"\n[PROCESSING] {file_path}")

#                 file_hash = get_sha256(file_path)
#                 print(f"[HASH] {file_hash}")

#                 model_version = fetch_model_version_by_hash(file_hash)
#                 if not model_version:
#                     continue

#                 model_id = model_version.get("modelId")
#                 model_info = {
#                     "modelVersion": model_version
#                 }

#                 if model_id:
#                     model_details = fetch_model_details(model_id)
#                     if model_details:
#                         model_info["model"] = model_details

#                 save_model_info(file_path, model_info)

def get_metadata_for_lora(file_path, output_dir):
    if file_path.endswith(EXTENSION):
        print(f"\n[PROCESSING] {file_path}")

        file_hash = get_sha256(file_path)
        print(f"[HASH] {file_hash}")

        model_version = fetch_model_version_by_hash(file_hash)
        if not model_version:
            return

        model_id = model_version.get("modelId")
        model_info = {
            "modelVersion": model_version
        }

        if model_id:
            model_details = fetch_model_details(model_id)
            if model_details:
                model_info["model"] = model_details

        file_name = os.path.basename(file_path)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
        save_model_info(os.path.join(output_dir, file_name), model_info)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python civitai_model_metadata_download.py <path_to_safetensors> <output_directory>")
        sys.exit(1)
    
    get_metadata_for_lora(sys.argv[1], sys.argv[2])

    # TEST_DIR = r"C:\Users\User\Downloads\test_dir"
    # # main(TEST_DIR)
    # for file in os.listdir(TEST_DIR):
    #     file_path = os.path.join(TEST_DIR, file)
    #     get_metadata_for_lora(file_path)