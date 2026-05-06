#!/usr/bin/env python3
"""Edit an image using OpenAI gpt-image-1 with retry for rate limits."""
import sys
import os
import base64
import time
from openai import OpenAI

def main():
    image_path = sys.argv[1]
    prompt = sys.argv[2]
    output_path = sys.argv[3]

    client = OpenAI()
    max_retries = 5

    for attempt in range(max_retries):
        try:
            result = client.images.edit(
                model="gpt-image-1",
                image=open(image_path, "rb"),
                prompt=prompt,
                n=1,
                size="1536x1024",
            )
            b64 = result.data[0].b64_json
            if b64:
                img_bytes = base64.standard_b64decode(b64)
                with open(output_path, "wb") as f:
                    f.write(img_bytes)
                print(f"MEDIA: {output_path}")
                return
            url = result.data[0].url
            if url:
                import urllib.request
                urllib.request.urlretrieve(url, output_path)
                print(f"MEDIA: {output_path}")
                return
            print("No image data", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            if "429" in str(e) or "rate_limit" in str(e).lower():
                wait = 15 * (attempt + 1)
                print(f"Rate limited, waiting {wait}s (attempt {attempt+1}/{max_retries})...", file=sys.stderr)
                time.sleep(wait)
            else:
                raise
    print("Max retries exceeded", file=sys.stderr)
    sys.exit(1)

if __name__ == "__main__":
    main()
