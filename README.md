# HTTP META

## Usage

Download [Meta](https://github.com/MetaCubeX/mihomo/releases), rename it to `http-meta` and move it to the `meta` folder.

Edit `meta/tpl.yaml` if necessary.

`pnpm i`

`HOST=127.0.0.1 PORT=9876 pnpm start`

## Start (always start a new one)

```console
curl --location '127.0.0.1:9876/start' \
--header 'Content-Type: application/json' \
--data '{
    "timeout": 1800000, // process will be killed after 30 minutes(default)
    "proxies": [
        {
            "name": "1",
            "server": "1.2.3.4",
            "port": 80,
            "type": "vmess",
            ...
        }
    ]
}'
```

### Response

```JSON
{
    "ports": [
        65534,
        65533
    ],
    "pid": 61289
}
```

## Retart(stop all and start a new one)

```console
curl --location '127.0.0.1:9876/start' \
--header 'Content-Type: application/json' \
--data '{
    "timeout": 1800000, // process will be killed after 30 minutes(default)
    "proxies": [
        {
            "name": "1",
            "server": "1.2.3.4",
            "port": 80,
            "type": "vmess",
            ...
        },
          {
            "name": "2",
            "server": "1.2.3.4",
            "port": 80,
            "type": "vmess",
            ...
        }
    ]
}'
```

### Response

```JSON
{
    "ports": [
        65534,
        65533
    ],
    "pid": 61289
}
```

## Stop

### Stop All

```console
curl --location --request POST '127.0.0.1:9876/stop'
```

### Stop by PID

```console
curl --location '127.0.0.1:9876/stop' \
--header 'Content-Type: application/json' \
--data '{
    "pid": [
        1,
        2
    ]
}'
```

### Response

```JSON
{
    "pid": null
}
```

## Get Stats

```console
curl --location '127.0.0.1:9876/stats' \
--header 'Content-Type: application/json'
```

### Response

```JSON
{
    "35955": {
        "pid": 35955,
        "mem": "2MB",
        "cpu": "0%"
    }
}
```

## Get Stats by PID

```console
curl --location '127.0.0.1:9876/stats' \
--header 'Content-Type: application/json' \
--data '{"pid": [35955]}'
```

### Response

```JSON
{
    "35955": {
        "pid": 35955,
        "mem": "2MB",
        "cpu": "0%"
    }
}
```
