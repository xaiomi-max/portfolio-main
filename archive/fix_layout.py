#!/usr/bin/env python3

with open('/Users/a1111/portfolio-site/index.html', 'r') as f:
    content = f.read()

# 1. Fix the comic card in intern section - change h-44 to h-48 and add relative class
# The comic card is the one with comic-test.png
old_img_line = '''                <div class="h-44 bg-gray-100 overflow-hidden">
                    <img src="data:image/png;base64,'''

new_img_line = '''                <div class="h-48 bg-gray-100 overflow-hidden relative">
                    <img src="data:image/png;base64,'''

# Find the comic card image (the one with comic-test) and fix its height
if old_img_line in content:
    content = content.replace(old_img_line, new_img_line, 1)
    print("Fixed comic card height and added relative class")
else:
    print("Could not find exact pattern, trying fuzzy match...")
    # Try finding the comic-test.png in the intern section
    idx = content.find('comic-test')
    if idx > 0:
        # Go back to find the h-44 div
        search_start = content.rfind('h-44', 0, idx)
        if search_start > 0:
            line_start = content.rfind('\n', 0, search_start)
            line_end = content.find('\n', search_start)
            print(f"Found at line: {content[line_start:line_end].strip()}")
            content = content[:search_start] + 'h-48' + content[search_start+4:]
            print("Fixed height")
        
        # Add relative class
        rel_start = content.find('bg-gray-100 overflow-hidden', idx - 500)
        if rel_start > 0:
            if 'relative' not in content[rel_start:rel_start+60]:
                content = content[:rel_start+27] + ' relative' + content[rel_start+27:]
                print("Added relative class")

# 2. Add caption overlay to comic card (like feishu report has)
comic_caption = '''                    <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
                        <p class="text-white text-xs">对同一张漫画原图在不同图生视频模型上的测试效果对比</p>
                    </div>
                </div>'''

# Find the comic card image end (the first </div> after comic-test img src)
comic_img_close = content.find('</div>', content.find('comic-test'))
# Find the NEXT </div> after that (the one closing the image container div)
comic_img_div_close = content.find('</div>', comic_img_close + 6)

if comic_img_div_close > 0:
    # Check if there's already a caption
    after_div = content[comic_img_div_close:comic_img_div_close+200]
    if 'gradient-to-t' not in after_div:
        content = content[:comic_img_div_close] + '\n' + comic_caption + content[comic_img_div_close+6:]
        print("Added caption overlay to comic card")

# 3. Fix the comic card's card title - change "个人项目" badge to "实习项目"
# Find the comic modal content and update the badge
comic_badge = '<span class="text-xs px-2.5 py-1 bg-purple-50 text-purple-600 rounded-full">个人项目</span>'
new_badge = '<span class="text-xs px-2.5 py-1 bg-purple-50 text-purple-600 rounded-full">实习项目</span>'
# But there might be two occurrences. Find the one in comic modal
comic_modal_start = content.find('comic: {')
if comic_modal_start > 0:
    # Only replace within the comic modal section
    comic_modal_section = content[comic_modal_start:comic_modal_start+500]
    if '个人项目' in comic_modal_section:
        content = content[:comic_modal_start] + comic_modal_section.replace('个人项目', '实习项目', 1) + content[comic_modal_start+500:]
        print("Updated comic modal badge to 实习项目")

with open('/Users/a1111/portfolio-site/index.html', 'w') as f:
    f.write(content)

print(f"\nFinal size: {len(content)} bytes")
print("Done! Open index.html to check the layout.")
