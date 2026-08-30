#!/usr/bin/env python3
import re

with open('/Users/a1111/portfolio-site/index.html', 'r') as f:
    content = f.read()

print(f"Original size: {len(content)} bytes")

# ====== CHANGE 1: Move comic card from personal to intern section ======

# The intern section grid needs to change from md:grid-cols-2 to md:grid-cols-3
# And we need to add the comic card after the novel card, before the closing </div>

# First, find the comic card block
comic_start = content.find('<!-- AI漫剧测评 -->')
comic_end = content.find('        </div>', comic_start)
# Find the SECOND </div> after comic_start (one closes the card, one closes the grid)
second_close = content.find('        </div>', comic_end + 12)
# The comic card ends at the FIRST </div> after the card content
# Actually let's find the exact pattern
comic_card_end = content.find('            </div>', comic_start)
comic_card_end = content.find('            </div>', comic_card_end + 12) + 12  # second </div> closes the card

# Extract the comic card HTML
comic_card = content[comic_start:comic_card_end]
print(f"Comic card extracted: {len(comic_card)} bytes")

# Remove the comic card from personal section
content = content[:comic_start] + content[comic_card_end:]

# Now find the intern section closing </div> (the one after the two intern cards)
# Find the closing of the intern grid
intern_grid_close = content.find('        </div>', content.find('<!-- 实习项目 -->'))
intern_grid_close = content.find('        </div>', intern_grid_close + 12)
intern_grid_close = content.find('        </div>', intern_grid_close + 12)
# This should be line 102 in the original

# Insert comic card before the intern grid closing
content = content[:intern_grid_close] + '\n' + comic_card + '\n' + content[intern_grid_close:]

# Change grid from md:grid-cols-2 to md:grid-cols-3
content = content.replace(
    'class="grid md:grid-cols-2 gap-6 mb-16">',
    'class="grid md:grid-cols-3 gap-6 mb-16">',
    1  # only first occurrence (intern section)
)

# ====== CHANGE 2: Add clickable image preview to modals ======

# For recruit modal - add image preview at top
# Find the recruit content template
recruit_content_start = content.find('recruit: {')
recruit_content_start = content.find("content: `", recruit_content_start)

# Add image preview after the title line in the modal content
# We need to find the feishu-report base64 data
feishu_src_start = content.find('src="data:image/jpeg;base64,')
feishu_src_end = content.find('"', feishu_src_start + 5)
feishu_base64 = content[feishu_src_start+5:feishu_src_end]

# Add image to recruit modal (after the first div class mb-4)
insert_point = content.find('<div class="mb-4 p-3 bg-gray-50 rounded-lg">', recruit_content_start)
image_html = f'''
                    <div class="mb-4">
                        <img src="{feishu_base64}" alt="飞书报告" style="width:100%;max-width:600px;cursor:pointer;border-radius:8px;" onclick="window.open(this.src)">
                        <p class="text-xs text-gray-400 mt-1">点击图片放大查看</p>
                    </div>
'''
content = content[:insert_point] + image_html + content[insert_point:]

# For novel modal - add image preview
novel_content_start = content.find('novel: {')
novel_content_start = content.find("content: `", novel_content_start)

novel_src_start = content.find('src="data:image/jpeg;base64,', content.find('novel-board'))
novel_src_end = content.find('"', novel_src_start + 5)
novel_base64 = content[novel_src_start+5:novel_src_end]

insert_point = content.find('<div class="mb-4 p-3 bg-gray-50 rounded-lg">', novel_content_start)
image_html = f'''
                    <div class="mb-4">
                        <img src="{novel_base64}" alt="小说产线看板" style="width:100%;max-width:600px;cursor:pointer;border-radius:8px;" onclick="window.open(this.src)">
                        <p class="text-xs text-gray-400 mt-1">点击图片放大查看</p>
                    </div>
'''
content = content[:insert_point] + image_html + content[insert_point:]

# For comic modal - add image preview
comic_content_start = content.find('comic: {')
comic_content_start = content.find("content: `", comic_content_start)

comic_src_start = content.find('src="data:image/png;base64,', content.find('comic-test'))
comic_src_end = content.find('"', comic_src_start + 5)
comic_base64 = content[comic_src_start+5:comic_src_end]

insert_point = content.find('<div class="mb-4 p-3 bg-gray-50 rounded-lg">', comic_content_start)
image_html = f'''
                    <div class="mb-4">
                        <img src="{comic_base64}" alt="漫剧测试" style="width:100%;max-width:600px;cursor:pointer;border-radius:8px;" onclick="window.open(this.src)">
                        <p class="text-xs text-gray-400 mt-1">点击图片放大查看</p>
                    </div>
'''
content = content[:insert_point] + image_html + content[insert_point:]

# For memoai modal - add image preview
memoai_content_start = content.find('memoai: {')
memoai_content_start = content.find("content: `", memoai_content_start)

memoai_src_start = content.find('src="data:image/png;base64,', content.find('memoai-preview'))
memoai_src_end = content.find('"', memoai_src_start + 5)
memoai_base64 = content[memoai_src_start+5:memoai_src_end]

insert_point = content.find('<div class="mb-4 p-3 bg-gray-50 rounded-lg">', memoai_content_start)
image_html = f'''
                    <div class="mb-4">
                        <img src="{memoai_base64}" alt="MemoAI设计稿" style="width:100%;max-width:600px;cursor:pointer;border-radius:8px;" onclick="window.open(this.src)">
                        <p class="text-xs text-gray-400 mt-1">点击图片放大查看</p>
                    </div>
'''
content = content[:insert_point] + image_html + content[insert_point:]

# For jobmate modal - add image preview
jobmate_content_start = content.find('jobmate: {')
jobmate_content_start = content.find("content: `", jobmate_content_start)

jobmate_src_start = content.find('src="data:image/png;base64,', content.find('jobmate-preview'))
jobmate_src_end = content.find('"', jobmate_src_start + 5)
jobmate_base64 = content[jobmate_src_start+5:jobmate_src_end]

insert_point = content.find('<div class="mb-4 p-3 bg-gray-50 rounded-lg">', jobmate_content_start)
image_html = f'''
                    <div class="mb-4">
                        <img src="{jobmate_base64}" alt="JobMate设计稿" style="width:100%;max-width:600px;cursor:pointer;border-radius:8px;" onclick="window.open(this.src)">
                        <p class="text-xs text-gray-400 mt-1">点击图片放大查看</p>
                    </div>
'''
content = content[:insert_point] + image_html + content[insert_point:]

# ====== CHANGE 3: Update comic modal tags to show it's an intern project ======
content = content.replace(
    '<span class="text-xs px-2.5 py-1 bg-purple-50 text-purple-600 rounded-full">个人项目</span>',
    '<span class="text-xs px-2.5 py-1 bg-blue-50 text-blue-600 rounded-full">实习项目</span>',
    1  # only the first occurrence (comic modal)
)

with open('/Users/a1111/portfolio-site/index.html', 'w') as f:
    f.write(content)

print(f"Final size: {len(content)} bytes")
print("Done! Open index.html in browser to check.")
