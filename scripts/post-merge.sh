#!/bin/bash
set -e
npm install
npm run --workspace=@workspace/db push
