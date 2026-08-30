#!/usr/bin/env python3
import base64

with open("/Users/a1111/Downloads/ChatGPT Image 2026年7月9日 18_42_50.png", "rb") as f:
    new_data = f.read()
new_b64 = base64.b64encode(new_data).decode()

with open("/Users/a1111/portfolio-site/index.html", "r") as f:
    content = f.read()

# Find the memoai card image - unique marker is the card div before it
# Find "memoai-preview" in the HTML (it was the old file name reference that got inlined)
# Actually the first memoai image is the card cover, the second is in the modal
# The card cover is in the first occurrence

# Find the line with MemoAI card - look for <!-- MemoAI -->
memoai_comment = content.find('<!-- MemoAI -->')
if memoai_comment < 0:
    # Try finding the card differently
    # Look for the card with onclick='memoai'
    card_start = content.find("onclick=\"openModal('memoai')\"")
    # Go forward to find the img src
    img_src_start = content.find('src="data:image/png;base64,', card_start)
else:
    img_src_start = content.find('src="data:image/png;base64,', memoai_comment)

if img_src_start > 0:
    img_src_end = content.find('"', img_src_start + 30)
    new_src = f'src="data:image/png;base64,{new_b64}"'
    content = content[:img_src_start+5] + new_src[5:] + content[img_src_end:]
    print(f"✅ Replaced card cover image for MemoAI")
else:
    print("❌ Could not find card cover image")

# Also replace the modal preview image if it exists
# The modal section has the second occurrence
second_start = content.find('src="data:image/png;base64,', content.find('memoai-preview'))
if second_start > 0:
    second_end = content.find('"', second_start + 30)
    new_src2 = f'src="data:image/png;base64,{new_b64}"'
    content = content[:second_start+5] + new_src2[5:] + content[second_end:]
    print(f"✅ Replaced modal preview image for MemoAI")
else:
    print("ℹ️ No modal preview image found for MemoAI (may not exist)")

with open("/Users/a1111/portfolio-site/index.html", "w") as f:
    f.write(content)

print("Done!")
