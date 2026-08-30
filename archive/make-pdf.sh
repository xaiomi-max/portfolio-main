#!/bin/bash
# 从网页 index.html 重新渲染 PDF 作品集。
# 用法: ./make-pdf.sh [输出路径]   （不传则输出到 刘舒锐-AI产品经理作品集.pdf）
cd "$(dirname "$0")"
export NODE_PATH=/tmp/pf-verify/node_modules
exec node make-pdf.js "$1"
