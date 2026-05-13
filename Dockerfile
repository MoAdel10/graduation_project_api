FROM node:26-alpine3.22
WORKDIR /app

COPY package*.json ./
RUN npm install && npm i -g nodemon

COPY . .

EXPOSE 8000
CMD [ "npm","run","dev" ]